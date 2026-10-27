// Functions working out what the page shows: texts, sort orders and the
// contents of the lists. They take the page's state as arguments and
// don't touch the document, so that they can be tested; index.js builds
// the elements from their results.

import { removeInnerParents } from './ancestor_finder.js';

// Names ============================================================

// The initials of a name, such as 'K. N. N.' for 'Kari Nilsdtr Nærum
// (Lode)'. Parts in parentheses (birth names) are left out.
function initials(name) {
  return (name ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word][0].toUpperCase() + '.')
    .join(' ');
}

// The name of person as shown on the page. With initialsOnly, the
// persons in memberIds (the profiles in the group) are shown by their
// initials, so that a screenshot can be shared without showing who the
// matches are. Ancestors keep their names.
function displayName(person, initialsOnly, memberIds) {
  if (initialsOnly && memberIds.has(person.id())) {
    return initials(person.name());
  }
  return person.name();
}

// The profile list ================================================

// The completeness index as shown in the profile list: -log2(1 - index),
// which is n for a tree complete to n generations back.
function formatCompleteness(index) {
  return (-Math.log2(1 - index)).toFixed(1);
}

// Ways of sorting the profile list, chosen by clicking a column heading.
// Each gives a sort key: names A to Z, most complete generations first.
const profileSortKeys = {
  name: (profile, db, memo) => profile.name() ?? '',
  generations: (profile, db, memo) => -db.completenessIndex(profile.id(), memo),
};

// The profiles sorted on column (a key of profileSortKeys), reversed if
// asked. If column is undefined, the profiles are kept in the order
// added. The list given is not changed.
function sortProfiles(profiles, column, reversed, db) {
  if (column === undefined) {
    return profiles;
  }
  const memo = new Map();
  const key = profileSortKeys[column];
  const keys = new Map(
    profiles.map((profile) => [profile, key(profile, db, memo)]),
  );
  const direction = reversed ? -1 : 1;
  return profiles.toSorted((a, b) => {
    const keyA = keys.get(a);
    const keyB = keys.get(b);
    const order =
      typeof keyA === 'string' ? keyA.localeCompare(keyB) : keyA - keyB;
    return direction * order;
  });
}

// The sort state after clicking the heading of column: the same column
// again reverses the order, another one sorts on it.
function nextSortState(column, sortColumn, reversed) {
  return column === sortColumn
    ? { column, reversed: !reversed }
    : { column, reversed: false };
}

// The arrow after the heading of column: shown on the column sorted on.
function sortIndicator(column, sortColumn, reversed) {
  if (column !== sortColumn) {
    return '';
  }
  return reversed ? ' ▲' : ' ▼';
}

// The class of a profile's row in the list: 'excluded' if excluded from
// matching, otherwise 'ungrouped' if alone in its group, or ''.
function profileRowClass(id, excludedIds, ungroupedIds) {
  if (excludedIds.has(id)) {
    return 'excluded';
  }
  if (ungroupedIds.has(id)) {
    return 'ungrouped';
  }
  return '';
}

// Ancestor counts =================================================

// Compare the ancestor ids last shown for a profile with the current
// ones. Fetching should only add ancestors, so if there are fewer now,
// returns the ids lost and the suspects: persons still in the tree with
// fewer parent links than parent URLs, where the tree was most likely
// cut. Persons whose parents have not been fetched (parents undefined)
// are not suspects, since that is normal at the "back to" year limit.
// Returns undefined if the count did not go down.
function ancestorCountDrop(previous, current, profileId, db) {
  if (previous === undefined || current.size >= previous.size) {
    return undefined;
  }
  const suspects = [profileId, ...current]
    .map((id) => db.get(id))
    .filter(
      (person) =>
        person?.parents !== undefined &&
        [person.father(), person.mother()].filter(Boolean).length <
          person.parents.length,
    )
    .map((person) => person.id());
  return { lost: [...previous.difference(current)], suspects };
}

// The group list ==================================================

// The ids of the profiles alone in their group.
function ungroupedIds(groups) {
  return new Set(
    groups
      .filter((group) => group.persons.length === 1)
      .map((group) => group.persons[0].id()),
  );
}

// What the group list shows: for each group of more than one profile,
// its members and the ancestors to list (a Set of persons), leaving out
// those that are parents of others listed. People who share no ancestors with anyone
// are left out.
function groupListEntries(groups, db) {
  return groups
    .filter((group) => group.persons.length > 1)
    .map((group) => ({
      members: group.persons,
      ancestors: removeInnerParents(db, group.ancestors),
    }));
}

// Menu text for each of groupingAlgorithms.
const algorithmLabels = {
  sharedAncestors: 'Most shared ancestors',
  kinship: 'Kinship (closer ancestors count more)',
  closestAncestor: 'Closest common ancestor',
  rootDescendants: 'Root ancestor with most descendants',
};
// The ones that merge the most complete trees first have the label of
// the same scoring with this added.
const completenessSuffix = 'Completeness';
const completenessLabel = ' + consider completeness';

function algorithmLabel(name) {
  if (name.endsWith(completenessSuffix)) {
    const base = name.slice(0, -completenessSuffix.length);
    if (Object.hasOwn(algorithmLabels, base)) {
      return algorithmLabels[base] + completenessLabel;
    }
  }
  return algorithmLabels[name] ?? name;
}

// Messages and file names =========================================

// The message after building the tree of the profile named name.
function treeBuildingResult(name, stopped) {
  return (stopped ? 'Stopped' : 'Finished') + ' tree building for ' + name;
}

// A date as YYYY-MM-DD (in UTC), for file names.
function dateStamp(date) {
  return date.toISOString().slice(0, 10);
}

// The name of the file for saving the whole database.
function databaseFileName(date) {
  return 'acac-' + dateStamp(date) + '.json';
}

// The name of the file for saving the group named groupName.
function groupFileName(groupName, date) {
  return (
    'acac-group-' +
    (groupName === '' ? 'unnamed' : groupName) +
    '-' +
    dateStamp(date) +
    '.json'
  );
}

export {
  initials,
  displayName,
  formatCompleteness,
  sortProfiles,
  nextSortState,
  sortIndicator,
  profileRowClass,
  ancestorCountDrop,
  ungroupedIds,
  groupListEntries,
  algorithmLabel,
  treeBuildingResult,
  dateStamp,
  databaseFileName,
  groupFileName,
};
