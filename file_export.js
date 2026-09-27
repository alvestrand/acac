// Conversion of the database and the groups to and from a single JSON
// string, used for saving to and loading from a file.
// Groups are stored in a Storage object (normally localStorage) under
// keys of the form 'profileSet-<group name>'.

const profileSetPrefix = 'profileSet-';

// Return all groups in storage as a map of name -> profile list.
function storedGroups(storage) {
  const groups = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key.startsWith(profileSetPrefix)) {
      groups[key.substring(profileSetPrefix.length)] =
        JSON.parse(storage.getItem(key));
    }
  }
  return groups;
}

// Represent the database and all groups as a JSON string.
// The current group is included even if it has not been saved to storage.
function exportToJsonString(db, storage, currentGroup, currentProfileList) {
  const groups = storedGroups(storage);
  groups[currentGroup] = currentProfileList;
  return JSON.stringify({
    ...db.toJsonObject(),
    groups: groups,
    currentGroup: currentGroup
  }, null, 2);
}

// Parse a string produced by exportToJsonString.
// Throws an Error if the string is not a valid export.
function parseExport(data) {
  const imported = JSON.parse(data);
  if (!imported || typeof imported.persons !== 'object'
      || typeof imported.groups !== 'object') {
    throw new Error('Not a saved database');
  }
  return imported;
}

// Replace the contents of the database and all groups in storage with
// the result of parseExport. Returns the name of the current group.
function applyImport(imported, db, storage) {
  db.clear();
  db.fromJsonObject(imported);
  for (const name of Object.keys(storedGroups(storage))) {
    storage.removeItem(profileSetPrefix + name);
  }
  for (const [name, profiles] of Object.entries(imported.groups)) {
    storage.setItem(profileSetPrefix + name, JSON.stringify(profiles));
  }
  const currentGroup = imported.currentGroup ?? '';
  storage.setItem('currentSet', currentGroup);
  return currentGroup;
}

export {
  storedGroups,
  exportToJsonString,
  parseExport,
  applyImport
}
