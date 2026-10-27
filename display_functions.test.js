import { Database } from './database.js';
import { groupingAlgorithms } from './ancestor_finder.js';
import {
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
} from './display_functions.js';

// Two siblings with a known father and grandfather, and a person
// unrelated to them.
function makeFamily() {
  const db = new Database();
  db.addWithAttributes('gf', { name: 'Grandfather' });
  db.addWithAttributes('f', { name: 'Father', father: 'gf' });
  db.addWithAttributes('a', { name: 'Anna Berg (Dal)', father: 'f' });
  db.addWithAttributes('b', { name: 'Bjørn Berg', father: 'f' });
  db.addWithAttributes('c', { name: 'Carl Unrelated' });
  db.createAncestors();
  return db;
}

test('initials leave out names in parentheses', () => {
  expect(initials('Kari Nilsdtr Nærum (Lode)')).toBe('K. N. N.');
  expect(initials('  ørjan  nilsen ')).toBe('Ø. N.');
  expect(initials(undefined)).toBe('');
});

test('displayName shows initials only for members, when asked', () => {
  const db = makeFamily();
  const members = new Set(['a']);
  expect(displayName(db.get('a'), true, members)).toBe('A. B.');
  expect(displayName(db.get('f'), true, members)).toBe('Father');
  expect(displayName(db.get('a'), false, members)).toBe('Anna Berg (Dal)');
});

test('formatCompleteness shows complete generations', () => {
  expect(formatCompleteness(0)).toBe('0.0');
  expect(formatCompleteness(0.5)).toBe('1.0');
  expect(formatCompleteness(0.75)).toBe('2.0');
});

test('sortProfiles sorts on name or generations, and can reverse', () => {
  const db = makeFamily();
  const profiles = ['c', 'b', 'a'].map((id) => db.get(id));
  const ids = (list) => list.map((profile) => profile.id());
  expect(sortProfiles(profiles, undefined, false, db)).toBe(profiles);
  expect(ids(sortProfiles(profiles, 'name', false, db))).toStrictEqual([
    'a',
    'b',
    'c',
  ]);
  expect(ids(sortProfiles(profiles, 'name', true, db))).toStrictEqual([
    'c',
    'b',
    'a',
  ]);
  // Most complete first; a and b are equally complete, and keep their
  // order.
  expect(ids(sortProfiles(profiles, 'generations', false, db))).toStrictEqual([
    'b',
    'a',
    'c',
  ]);
  expect(ids(profiles)).toStrictEqual(['c', 'b', 'a']);
});

test('nextSortState reverses the same column, resets for another', () => {
  expect(nextSortState('name', undefined, false)).toStrictEqual({
    column: 'name',
    reversed: false,
  });
  expect(nextSortState('name', 'name', false)).toStrictEqual({
    column: 'name',
    reversed: true,
  });
  expect(nextSortState('generations', 'name', true)).toStrictEqual({
    column: 'generations',
    reversed: false,
  });
});

test('sortIndicator marks only the column sorted on', () => {
  expect(sortIndicator('name', 'name', false)).toBe(' ▼');
  expect(sortIndicator('name', 'name', true)).toBe(' ▲');
  expect(sortIndicator('name', 'generations', false)).toBe('');
});

test('profileRowClass prefers excluded to ungrouped', () => {
  const excluded = new Set(['x']);
  const ungrouped = new Set(['x', 'u']);
  expect(profileRowClass('x', excluded, ungrouped)).toBe('excluded');
  expect(profileRowClass('u', excluded, ungrouped)).toBe('ungrouped');
  expect(profileRowClass('g', excluded, ungrouped)).toBe('');
});

test('ancestorCountDrop reports only a lower count', () => {
  const db = makeFamily();
  expect(ancestorCountDrop(undefined, new Set(['f']), 'a', db)).toBeUndefined();
  expect(
    ancestorCountDrop(new Set(['f']), new Set(['f', 'gf']), 'a', db),
  ).toBeUndefined();
  expect(
    ancestorCountDrop(new Set(['f', 'gf']), new Set(['f']), 'a', db),
  ).toStrictEqual({ lost: ['gf'], suspects: [] });
});

test('ancestorCountDrop suspects missing links, not unfetched parents', () => {
  const db = makeFamily();
  // The father has a parent URL but lost the link to the grandfather;
  // the profile's parents were never fetched.
  db.get('f').parents = ['https://www.geni.com/api/profile-gf'];
  db.get('f').setFather(undefined);
  expect(
    ancestorCountDrop(new Set(['f', 'gf']), new Set(['f']), 'a', db),
  ).toStrictEqual({ lost: ['gf'], suspects: ['f'] });
});

test('ungroupedIds and groupListEntries split groups by size', () => {
  const db = makeFamily();
  const groups = groupingAlgorithms.sharedAncestors(
    ['a', 'b', 'c'].map((id) => db.get(id)),
    db,
  );
  expect(ungroupedIds(groups)).toStrictEqual(new Set(['c']));
  const entries = groupListEntries(groups, db);
  expect(entries.length).toBe(1);
  expect(entries[0].members.map((person) => person.id()).sort()).toStrictEqual([
    'a',
    'b',
  ]);
  // The grandfather is left out, as the father is listed.
  expect([...entries[0].ancestors].map((person) => person.id())).toStrictEqual([
    'f',
  ]);
});

test('algorithmLabel names the completeness variants', () => {
  expect(algorithmLabel('kinship')).toBe(
    'Kinship (closer ancestors count more)',
  );
  expect(algorithmLabel('kinshipCompleteness')).toBe(
    'Kinship (closer ancestors count more) + consider completeness',
  );
  expect(algorithmLabel('unknownCompleteness')).toBe('unknownCompleteness');
});

test('treeBuildingResult tells whether the build was stopped', () => {
  expect(treeBuildingResult('A. B.', false)).toBe(
    'Finished tree building for A. B.',
  );
  expect(treeBuildingResult('A. B.', true)).toBe(
    'Stopped tree building for A. B.',
  );
});

test('file names carry the date and the group name', () => {
  const date = new Date('2026-10-18T12:00:00Z');
  expect(dateStamp(date)).toBe('2026-10-18');
  expect(databaseFileName(date)).toBe('acac-2026-10-18.json');
  expect(groupFileName('segment 7', date)).toBe(
    'acac-group-segment 7-2026-10-18.json',
  );
  expect(groupFileName('', date)).toBe('acac-group-unnamed-2026-10-18.json');
});
