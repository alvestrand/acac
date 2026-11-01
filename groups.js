// Groups of profiles, kept in a Storage object. The page keeps them in
// memory and saves them in the database file (see opfsdb.js); older
// versions kept them in localStorage.
// Each group is stored under a key of the form 'profileSet-<group name>',
// holding a JSON object with members and notes. Older versions stored a
// JSON array of person ids (or person records); those are still accepted.
// Members excluded from matching are stored under 'excludedSet-<group
// name>', as a JSON array of ids; the key is left out when none are.
// The name of the group last worked on is stored under 'currentSet'.

const profileSetPrefix = 'profileSet-';
const excludedSetPrefix = 'excludedSet-';
const currentGroupKey = 'currentSet';

// Convert a group's member list to a list of ids.
// Accepts both ids and person records as stored by older versions.
function profileIds(entries) {
  return entries.map((entry) => (typeof entry === 'string' ? entry : entry.id));
}

// Separator put between two versions of a group's notes that were both
// changed since they were last saved. Geni uses the same one when it
// merges the About fields of two profiles.
const notesSeparator = '\n---\n';

// Minimal in-memory implementation of the Storage interface
// (localStorage). Holds the groups while the database file is in use.
class MemoryStorage {
  #items = new Map();
  get length() {
    return this.#items.size;
  }
  key(index) {
    return [...this.#items.keys()][index] ?? null;
  }
  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }
  setItem(key, value) {
    this.#items.set(key, String(value));
  }
  removeItem(key) {
    this.#items.delete(key);
  }
}

class GroupStore {
  #storage;
  #currentStorage;

  // The groups are kept in storage. The name of the current group is
  // kept in currentStorage, which defaults to the same Storage; it can
  // be separate because the current group is not shared between tabs.
  constructor(storage, currentStorage = storage) {
    this.#storage = storage;
    this.#currentStorage = currentStorage;
  }

  // Return all groups as a map of name -> list of person ids.
  groups() {
    const groups = {};
    for (let i = 0; i < this.#storage.length; i++) {
      const key = this.#storage.key(i);
      if (key?.startsWith(profileSetPrefix)) {
        groups[key.substring(profileSetPrefix.length)] = profileIds(
          this.#group(key.substring(profileSetPrefix.length)).members,
        );
      }
    }
    return groups;
  }

  has(name) {
    return this.#storage.getItem(profileSetPrefix + name) !== null;
  }

  // Return the member list of a group as stored (ids, or person records
  // from older versions). Returns an empty list for unknown groups.
  entries(name) {
    return this.#group(name).members;
  }

  save(name, ids) {
    const group = this.#group(name);
    group.members = ids;
    this.#saveGroup(name, group);
  }

  notes(name) {
    return this.#group(name).notes;
  }

  saveNotes(name, notes) {
    const group = this.#group(name);
    group.notes = notes;
    this.#saveGroup(name, group);
  }

  #group(name) {
    const stored = this.#storage.getItem(profileSetPrefix + name);
    if (!stored) {
      return { members: [], notes: '' };
    }
    const group = JSON.parse(stored);
    return Array.isArray(group)
      ? { members: group, notes: '' }
      : { members: group.members ?? [], notes: group.notes ?? '' };
  }

  #saveGroup(name, group) {
    this.#storage.setItem(profileSetPrefix + name, JSON.stringify(group));
  }

  remove(name) {
    this.#storage.removeItem(profileSetPrefix + name);
    this.#storage.removeItem(excludedSetPrefix + name);
  }

  // The ids of the members of a group excluded from matching.
  excluded(name) {
    const stored = this.#storage.getItem(excludedSetPrefix + name);
    return stored ? JSON.parse(stored) : [];
  }

  saveExcluded(name, ids) {
    if (ids.length === 0) {
      this.#storage.removeItem(excludedSetPrefix + name);
    } else {
      this.#storage.setItem(excludedSetPrefix + name, JSON.stringify(ids));
    }
  }

  currentName() {
    return this.#currentStorage.getItem(currentGroupKey) ?? '';
  }

  setCurrentName(name) {
    this.#currentStorage.setItem(currentGroupKey, name);
  }

  // All groups as a plain object of name -> { members, notes, excluded },
  // where members and excluded are lists of ids.
  toObject() {
    const result = {};
    for (const name of Object.keys(this.groups())) {
      const group = this.#group(name);
      result[name] = {
        members: profileIds(group.members),
        notes: group.notes,
        excluded: this.excluded(name),
      };
    }
    return result;
  }

  // Replace all groups with those of an object made by toObject.
  replaceAll(groups) {
    for (const name of Object.keys(this.groups())) {
      this.remove(name);
    }
    for (const [name, group] of Object.entries(groups)) {
      this.save(name, group.members);
      this.saveNotes(name, group.notes);
      this.saveExcluded(name, group.excluded);
    }
  }

  // Names to show in the group menu: all stored groups plus the current
  // group, which may not have been saved yet. Sorted, without duplicates.
  names(currentGroup) {
    const names = new Set(Object.keys(this.groups()));
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

  // Save the members of the group being left, and those of them excluded
  // from matching, and make another group the current one. The caller
  // loads the new group's members afterwards.
  switchTo(fromGroup, fromIds, toGroup, fromExcludedIds = []) {
    this.save(fromGroup, fromIds);
    this.saveExcluded(fromGroup, fromExcludedIds);
    this.setCurrentName(toGroup);
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
      const present = m ?? t;
      if (!b || !sameGroup(present, b)) {
        merged[name] = present;
      }
    }
  }
  return { groups: merged, conflicts };
}

export { profileIds, GroupStore, MemoryStorage, mergeGroups, notesSeparator };
