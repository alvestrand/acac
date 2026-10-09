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

// A single group can also be saved to its own file, so that work on it
// can be continued elsewhere. The file holds the group name, the member
// ids in group order, and the person records of the members and all
// their ancestors found so far.

// The members and all their known ancestors, as Person objects,
// each person once. Follows the father and mother links in the database.
function groupPersons(memberIds, db) {
  const persons = new Map();
  const toVisit = [...memberIds];
  while (toVisit.length > 0) {
    const id = toVisit.shift();
    const person = db.get(id);
    if (!person || persons.has(id)) {
      continue;
    }
    persons.set(id, person);
    for (const parentId of [person.father(), person.mother()]) {
      if (parentId) {
        toVisit.push(parentId);
      }
    }
  }
  return [...persons.values()];
}

// Represent a group as a JSON string.
function exportGroupToJsonString(groupName, memberIds, db) {
  return JSON.stringify({
    groupName: groupName,
    members: memberIds,
    persons: groupPersons(memberIds, db)
  }, null, 2);
}

// Parse a string produced by exportGroupToJsonString.
// Throws an Error if the string is not a valid group file.
function parseGroupExport(data) {
  const imported = JSON.parse(data);
  if (!imported || typeof imported.groupName !== 'string'
      || !Array.isArray(imported.members)
      || !imported.members.every(id => typeof id === 'string')
      || !Array.isArray(imported.persons)
      || !imported.persons.every(person => typeof person?.id === 'string'
                                 && typeof person.attributes === 'object'
                                 && person.attributes !== null)) {
    throw new Error('Not a saved group');
  }
  return imported;
}

// Convert Geni's updated_at attribute (seconds since the epoch, as a
// string) to a number. Records without a usable timestamp count as oldest.
function timestamp(updatedAt) {
  return Number(updatedAt) || 0;
}

// Merge the persons from parseGroupExport into the database.
// A person already in the database is replaced only if the record
// in the file has a newer timestamp; otherwise the database record is kept.
// Parent links are not covered by Geni's timestamp, so links found
// in only one of the two records are kept either way.
// Returns the member ids in group order, and how many persons
// were added, replaced and kept.
function mergeGroupImport(imported, db) {
  const result = { ids: imported.members, added: 0, replaced: 0, kept: 0 };
  for (const record of imported.persons) {
    const existing = db.get(record.id);
    if (!existing) {
      const person = db.addWithAttributes(record.id, record.attributes);
      person.parents = record.parents;
      result.added++;
    } else if (timestamp(record.attributes.updated_at)
               > timestamp(existing.attribute('updated_at'))) {
      const attributes = { ...record.attributes };
      attributes.father ??= existing.father();
      attributes.mother ??= existing.mother();
      const person = db.addWithAttributes(record.id, attributes);
      person.parents = record.parents ?? existing.parents;
      result.replaced++;
    } else {
      if (!existing.father() && record.attributes.father) {
        existing.setFather(record.attributes.father);
      }
      if (!existing.mother() && record.attributes.mother) {
        existing.setMother(record.attributes.mother);
      }
      existing.parents ??= record.parents;
      result.kept++;
    }
  }
  return result;
}

export {
  exportToJsonString,
  parseExport,
  applyImport,
  exportGroupToJsonString,
  parseGroupExport,
  mergeGroupImport
}
