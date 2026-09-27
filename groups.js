// Groups of profiles, kept in a Storage object (normally localStorage).
// Each group is stored under a key of the form 'profileSet-<group name>',
// holding a JSON array of person ids. Older versions stored whole person
// records instead of ids; those are still accepted when reading.
// The name of the group last worked on is stored under 'currentSet'.

const profileSetPrefix = 'profileSet-';
const currentGroupKey = 'currentSet';

// Convert a group's member list to a list of ids.
// Accepts both ids and person records as stored by older versions.
function profileIds(entries) {
  return entries.map(entry => typeof entry === 'string' ? entry : entry.id);
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
      if (key.startsWith(profileSetPrefix)) {
        groups[key.substring(profileSetPrefix.length)] =
          profileIds(JSON.parse(this.#storage.getItem(key)));
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
    const stored = this.#storage.getItem(profileSetPrefix + name);
    return stored ? JSON.parse(stored) : [];
  }

  save(name, ids) {
    this.#storage.setItem(profileSetPrefix + name, JSON.stringify(ids));
  }

  remove(name) {
    this.#storage.removeItem(profileSetPrefix + name);
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

  // Save the members of the group being left, and make another group
  // the current one. The caller loads the new group's members afterwards.
  switchTo(fromGroup, fromIds, toGroup) {
    this.save(fromGroup, fromIds);
    this.setCurrentName(toGroup);
  }
}

export {
  profileIds,
  GroupStore
}
