// Conversion of the database and the groups to and from a single JSON
// string, used for saving to and loading from a file.
// In the file, each group is a list of person ids. The members of each
// group excluded from matching are under excluded, as a map of group name
// -> list of ids; files from older versions have none.

import { profileIds } from './groups.js';

// Represent the database and all groups in the GroupStore as a JSON string.
// The current group is included even if it has not been saved.
function exportToJsonString(
  db,
  groupStore,
  currentGroup,
  currentProfileIds,
  currentExcludedIds = [],
) {
  const groups = groupStore.groups();
  groups[currentGroup] = currentProfileIds;
  const excluded = {};
  const notes = {};
  for (const name of Object.keys(groups)) {
    const ids =
      name === currentGroup ? currentExcludedIds : groupStore.excluded(name);
    if (ids.length > 0) {
      excluded[name] = ids;
    }
    const groupNotes = groupStore.notes(name);
    if (groupNotes !== '') {
      notes[name] = groupNotes;
    }
  }
  return JSON.stringify(
    {
      ...db.toJsonObject(),
      groups: groups,
      excluded: excluded,
      groupNotes: notes,
      currentGroup: currentGroup,
    },
    null,
    2,
  );
}

// Parse a string produced by exportToJsonString.
// Throws an Error if the string is not a valid export.
function parseExport(data) {
  const imported = JSON.parse(data);
  if (
    !imported ||
    typeof imported.persons !== 'object' ||
    typeof imported.groups !== 'object'
  ) {
    throw new Error('Not a saved database');
  }
  return imported;
}

// Replace the contents of the database and all groups in the GroupStore
// with the result of parseExport. Returns the name of the current group
// to select.
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
    groupStore.saveExcluded(name, imported.excluded?.[name] ?? []);
    groupStore.saveNotes(name, imported.groupNotes?.[name] ?? '');
  }
  return imported.currentGroup ?? '';
}

// A single group can also be saved to its own file, so that work on it
// can be continued elsewhere. The file holds the group name, the member
// ids in group order, the ids of the members excluded from matching
// (missing in files from older versions), and the person records of the
// members and all their ancestors found so far.

// The members and all their known ancestors, as Person objects,
// each person once. Follows the father and mother links in the database.
function groupPersons(memberIds, db) {
  let ids = new Set(memberIds.filter((id) => db.get(id)));
  for (const id of memberIds) {
    ids = ids.union(db.ancestorIds(id));
  }
  return [...ids].map((id) => db.get(id));
}

// Represent a group as a JSON string.
function exportGroupToJsonString(
  groupName,
  memberIds,
  db,
  excludedIds = [],
  notes = '',
) {
  return JSON.stringify(
    {
      groupName: groupName,
      members: memberIds,
      excluded: excludedIds,
      notes: notes,
      persons: groupPersons(memberIds, db),
    },
    null,
    2,
  );
}

// Parse a string produced by exportGroupToJsonString.
// Throws an Error if the string is not a valid group file.
function parseGroupExport(data) {
  const imported = JSON.parse(data);
  if (
    !imported ||
    typeof imported.groupName !== 'string' ||
    !Array.isArray(imported.members) ||
    !imported.members.every((id) => typeof id === 'string') ||
    (imported.excluded !== undefined &&
      !(
        Array.isArray(imported.excluded) &&
        imported.excluded.every((id) => typeof id === 'string')
      )) ||
    (imported.notes !== undefined && typeof imported.notes !== 'string') ||
    !Array.isArray(imported.persons) ||
    !imported.persons.every(
      (person) =>
        typeof person?.id === 'string' &&
        typeof person.attributes === 'object' &&
        person.attributes !== null,
    )
  ) {
    throw new Error('Not a saved group');
  }
  return imported;
}

// Merge the persons from parseGroupExport into the database.
// Persons are merged by Database.mergeRecord. Persons known to be merged
// into others on Geni are left out, and ids in the file are changed to
// the ids those persons were merged into.
// Returns the member ids in group order, the ids of the members excluded
// from matching, and how many persons were added, replaced and kept.
function mergeGroupImport(imported, db) {
  const ids = [...new Set(imported.members.map((id) => db.currentId(id)))];
  const excluded = new Set(
    (imported.excluded ?? []).map((id) => db.currentId(id)),
  );
  const result = {
    ids: ids,
    excluded: ids.filter((id) => excluded.has(id)),
    added: 0,
    replaced: 0,
    kept: 0,
  };
  for (const original of imported.persons) {
    result[
      db.mergeRecord(original.id, original.attributes, original.parents)
    ]++;
  }
  return result;
}

export {
  exportToJsonString,
  parseExport,
  applyImport,
  exportGroupToJsonString,
  parseGroupExport,
  mergeGroupImport,
};
