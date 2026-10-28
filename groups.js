// Groups of profiles, kept in a Storage object (normally localStorage).
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

class GroupStore {
  #storage;

  constructor(storage) {
    this.#storage = storage;
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
    return this.#storage.getItem(currentGroupKey) ?? '';
  }

  setCurrentName(name) {
    this.#storage.setItem(currentGroupKey, name);
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

export { profileIds, GroupStore };
