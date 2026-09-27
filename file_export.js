// Conversion of the database and the groups to and from a single JSON
// string, used for saving to and loading from a file.
// In the file, each group is a list of person ids.

import { profileIds } from './groups.js';

// Represent the database and all groups in the GroupStore as a JSON string.
// The current group is included even if it has not been saved.
function exportToJsonString(db, groupStore, currentGroup, currentProfileIds) {
  const groups = groupStore.groups();
  groups[currentGroup] = currentProfileIds;
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

// Replace the contents of the database and all groups in the GroupStore
// with the result of parseExport. Returns the name of the current group.
// Files from older versions may have person records instead of ids
// in the groups; these are converted to ids.
function applyImport(imported, db, groupStore) {
  db.clear();
  db.fromJsonObject(imported);
  for (const name of Object.keys(groupStore.groups())) {
    groupStore.remove(name);
  }
  for (const [name, profiles] of Object.entries(imported.groups)) {
    groupStore.save(name, profileIds(profiles));
  }
  const currentGroup = imported.currentGroup ?? '';
  groupStore.setCurrentName(currentGroup);
  return currentGroup;
}

export {
  exportToJsonString,
  parseExport,
  applyImport
}
