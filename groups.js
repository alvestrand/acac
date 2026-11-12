// Groups of profiles, kept in memory while the page is open. The page
// saves them in the database file (see opfsdb.js). Each group has a list
// of member ids, notes, and a list of the members excluded from matching.

// Separator put between two versions of a group's notes that were both
// changed since they were last saved. Geni uses the same one when it
// merges the About fields of two profiles.
const notesSeparator = '\n---\n';

const profileSetPrefix = 'profileSet-';
const excludedSetPrefix = 'excludedSet-';

// Convert a group's member list to a list of ids.
// Accepts both ids and person records as stored by older versions.
function profileIds(entries) {
  return entries.map((entry) => (typeof entry === 'string' ? entry : entry.id));
}

// Read the groups that older versions stored in a Storage object
// (localStorage), as an object like the one GroupStore.toObject makes.
// Each group was stored under a key of the form 'profileSet-<group name>',
// holding a JSON object with members and notes, or a JSON array of person
// ids (or person records) in still older versions. Members excluded from
// matching were stored under 'excludedSet-<group name>', as a JSON array
// of ids.
function readStoredGroups(storage) {
  const groups = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(profileSetPrefix)) {
      const name = key.substring(profileSetPrefix.length);
      const stored = JSON.parse(storage.getItem(key));
      const group = Array.isArray(stored) ? { members: stored } : stored;
      const excluded = storage.getItem(excludedSetPrefix + name);
      groups[name] = {
        members: profileIds(group.members ?? []),
        notes: group.notes ?? '',
        excluded: excluded ? JSON.parse(excluded) : [],
      };
    }
  }
  return groups;
}

function copyGroup(group) {
  return {
    members: [...group.members],
    notes: group.notes,
    excluded: [...group.excluded],
  };
}

class GroupStore {
  // Map of group name -> { members, notes, excluded }.
  #groups = new Map();

  // Return all groups as a map of name -> list of person ids.
  groups() {
    return Object.fromEntries(
      [...this.#groups].map(([name, group]) => [name, [...group.members]]),
    );
  }

  has(name) {
    return this.#groups.has(name);
  }

  // Return the member ids of a group. Returns an empty list for unknown
  // groups.
  entries(name) {
    return [...this.#group(name).members];
  }

  save(name, ids) {
    this.#update(name, { members: [...ids] });
  }

  notes(name) {
    return this.#group(name).notes;
  }

  saveNotes(name, notes) {
    this.#update(name, { notes });
  }

  remove(name) {
    this.#groups.delete(name);
  }

  // The ids of the members of a group excluded from matching.
  excluded(name) {
    return [...this.#group(name).excluded];
  }

  saveExcluded(name, ids) {
    this.#update(name, { excluded: [...ids] });
  }

  #group(name) {
    return this.#groups.get(name) ?? { members: [], notes: '', excluded: [] };
  }

  #update(name, changes) {
    this.#groups.set(name, { ...this.#group(name), ...changes });
  }

  // All groups as a plain object of name -> { members, notes, excluded },
  // where members and excluded are lists of ids.
  toObject() {
    return Object.fromEntries(
      [...this.#groups].map(([name, group]) => [name, copyGroup(group)]),
    );
  }

  // Replace all groups with those of an object made by toObject.
  replaceAll(groups) {
    this.#groups = new Map(
      Object.entries(groups).map(([name, group]) => [name, copyGroup(group)]),
    );
  }

  // Names to show in the group menu: all stored groups plus the current
  // group, which may not have been saved yet. Sorted, without duplicates.
  names(currentGroup) {
    const names = new Set(this.#groups.keys());
    names.add(currentGroup);
    return [...names].sort();
  }

  // Create an empty group, unless one with that name already exists.
  // The name is trimmed. Returns the name, or null if it is blank.
  create(name) {
    const trimmed = name.trim();
    if (trimmed === '') {
      return null;
    }
    if (!this.has(trimmed)) {
      this.save(trimmed, []);
    }
    return trimmed;
  }

  // Save the members of a group, and those of them excluded from
  // matching, before another group is made the current one.
  saveMembers(name, ids, excludedIds = []) {
    this.save(name, ids);
    this.saveExcluded(name, excludedIds);
  }
}

// Three-way merge of a list used as a set: keeps what theirs has and
// what mine added to base, and drops what mine removed from base.
// The order of theirs is kept, with mine's additions at the end.
function mergeIdLists(base, mine, theirs) {
  const removed = new Set(base.filter((id) => !mine.includes(id)));
  const baseSet = new Set(base);
  const kept = theirs.filter((id) => !removed.has(id));
  const added = mine.filter((id) => !baseSet.has(id));
  return [...new Set([...kept, ...added])];
}

// Three-way merge of notes. If both sides changed them, both texts are
// kept, theirs first. Returns the notes and whether they conflicted.
function mergeNotes(base, mine, theirs) {
  if (mine === theirs || mine === base) {
    return { notes: theirs, conflict: false };
  }
  if (theirs === base) {
    return { notes: mine, conflict: false };
  }
  return { notes: theirs + notesSeparator + mine, conflict: true };
}

function sameGroup(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Merge the groups of two tabs, given as objects made by
// GroupStore.toObject. base is what both tabs started from, mine is
// the group state of the tab doing the merge and theirs is what the
// other tab saved. mapId converts an id to the one it is currently
// known by, after profile merges. A group changed in one tab survives
// its deletion in the other. Returns the merged groups and the names of
// the groups whose notes conflicted.
function mergeGroups(base, mine, theirs, mapId = (id) => id) {
  const empty = { members: [], notes: '', excluded: [] };
  const mapped = (group) =>
    group && {
      ...group,
      members: [...new Set(group.members.map(mapId))],
      excluded: [...new Set(group.excluded.map(mapId))],
    };
  const merged = {};
  const conflicts = [];
  const names = new Set([
    ...Object.keys(base),
    ...Object.keys(mine),
    ...Object.keys(theirs),
  ]);
  for (const name of [...names].sort()) {
    const b = mapped(base[name]);
    const m = mapped(mine[name]);
    const t = mapped(theirs[name]);
    if (m && t) {
      const notes = mergeNotes((b ?? empty).notes, m.notes, t.notes);
      if (notes.conflict) {
        conflicts.push(name);
      }
      merged[name] = {
        members: mergeIdLists((b ?? empty).members, m.members, t.members),
        notes: notes.notes,
        excluded: mergeIdLists((b ?? empty).excluded, m.excluded, t.excluded),
      };
    } else {
      // Present in one tab only: new there, or deleted in the other tab.
      // If it was deleted in both tabs, it is in neither.
      const present = m ?? t;
      if (present && (!b || !sameGroup(present, b))) {
        merged[name] = present;
      }
    }
  }
  return { groups: merged, conflicts };
}

export {
  profileIds,
  readStoredGroups,
  GroupStore,
  mergeGroups,
  notesSeparator,
};
