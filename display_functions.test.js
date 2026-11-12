import { Database } from './database.js';
import { groupingAlgorithms } from './ancestor_finder.js';
import {
  initials,
  hidesName,
  displayName,
  profileSuggestions,
  suggestionText,
  formatCompleteness,
  ancestorFraction,
  sortProfiles,
  nextSortState,
  sortIndicator,
  profileRowClass,
  ancestorCountDrop,
  ungroupedIds,
  groupListEntries,
  pathsToAncestor,
  descendantTree,
  displayedAncestorGroups,
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

test('displayName keeps the names of public members', () => {
  const db = new Database();
  db.addWithAttributes('a', { name: 'Anna Berg (Dal)', public: true });
  db.addWithAttributes('b', { name: 'Bjørn Berg', public: false });
  db.createAncestors();
  const members = new Set(['a', 'b']);
  expect(displayName(db.get('a'), true, members)).toBe('Anna Berg (Dal)');
  expect(displayName(db.get('b'), true, members)).toBe('B. B.');
  expect(hidesName(db.get('a'), true, members)).toBe(false);
  expect(hidesName(db.get('b'), true, members)).toBe(true);
  expect(hidesName(db.get('b'), false, members)).toBe(false);
});

test('ancestorFraction shows known out of all positions', () => {
  expect(ancestorFraction(44, 7)).toBe('44/128');
  expect(ancestorFraction(1, 1)).toBe('1/2');
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

test('pathsToAncestor returns every known parent path', () => {
  const db = new Database();
  db.addWithAttributes('ancestor', { name: 'Ancestor' });
  db.addWithAttributes('father', {
    name: 'Father',
    father: 'ancestor',
  });
  db.addWithAttributes('mother', {
    name: 'Mother',
    father: 'ancestor',
  });
  db.addWithAttributes('member', {
    name: 'Member',
    father: 'father',
    mother: 'mother',
  });
  db.createAncestors();

  const paths = pathsToAncestor(db, db.get('member'), db.get('ancestor'));
  expect(paths.map((path) => path.map((person) => person.id()))).toStrictEqual([
    ['member', 'father', 'ancestor'],
    ['member', 'mother', 'ancestor'],
  ]);
});

// The ids in a descendant tree, as nested arrays; members end in '*'.
function treeIds(nodes) {
  return nodes.map((node) => [
    node.person.id() + (node.isMember ? '*' : ''),
    treeIds(node.children),
  ]);
}

test('descendantTree joins shared paths and repeats a member reached twice', () => {
  const db = new Database();
  db.addWithAttributes('h', { name: 'Husband' });
  db.addWithAttributes('w', { name: 'Wife' });
  db.addWithAttributes('s1', { name: 'Son', father: 'h', mother: 'w' });
  db.addWithAttributes('s2', { name: 'Daughter', father: 'h', mother: 'w' });
  db.addWithAttributes('g1', { name: 'Grandson', father: 's1' });
  db.addWithAttributes('g2', { name: 'Granddaughter', mother: 's2' });
  // a descends from the couple through both children.
  db.addWithAttributes('a', { name: 'A', father: 'g1', mother: 'g2' });
  db.addWithAttributes('b', { name: 'B', father: 'g1' });
  db.addWithAttributes('c', { name: 'C' });
  db.createAncestors();
  const { roots, unconnected } = descendantTree(
    db,
    ['a', 'b', 'c'].map((id) => db.get(id)),
    [db.get('h'), db.get('w')],
  );
  expect(treeIds(roots)).toStrictEqual([
    [
      's1',
      [
        [
          'g1',
          [
            ['a*', []],
            ['b*', []],
          ],
        ],
      ],
    ],
    ['s2', [['g2', [['a*', []]]]]],
  ]);
  expect(unconnected.map((person) => person.id())).toStrictEqual(['c']);
});

test('descendantTree marks a member who is on the path to another', () => {
  const db = new Database();
  db.addWithAttributes('h', { name: 'Husband' });
  db.addWithAttributes('p', { name: 'Parent', father: 'h' });
  db.addWithAttributes('k', { name: 'Kid', father: 'p' });
  db.createAncestors();
  const { roots } = descendantTree(
    db,
    [db.get('p'), db.get('k')],
    [db.get('h')],
  );
  expect(treeIds(roots)).toStrictEqual([['p*', [['k*', []]]]]);
});

test('displayedAncestorGroups pairs co-parents and orders husband first', () => {
  const db = new Database();
  db.addWithAttributes('other', { name: 'Other ancestor', gender: 'male' });
  db.addWithAttributes('husband', { name: 'Husband', gender: 'male' });
  db.addWithAttributes('wife', { name: 'Wife', gender: 'female' });
  db.addWithAttributes('child1', {
    name: 'Child one',
    father: 'husband',
    mother: 'wife',
  });
  db.addWithAttributes('child2', {
    name: 'Child two',
    father: 'husband',
    mother: 'wife',
  });
  db.addWithAttributes('member1', { name: 'Member one', father: 'child1' });
  db.addWithAttributes('member2', { name: 'Member two', father: 'child2' });
  db.createAncestors();

  const groups = displayedAncestorGroups(
    {
      members: [db.get('member1'), db.get('member2')],
      ancestors: new Set([db.get('wife'), db.get('other'), db.get('husband')]),
    },
    db,
  );

  expect(
    groups.map((group) => group.ancestors.map((person) => person.id())),
  ).toStrictEqual([['husband', 'wife'], ['other']]);
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

// The members of two groups, for the profile suggestions. Kari is in
// both groups, so she is listed twice.
function makeSuggestionPersons() {
  const db = new Database();
  const kari = db.addWithAttributes('kari', {
    name: 'Kari Nilsdtr Nærum',
    birth: { date: { year: 1790 } },
  });
  const ola = db.addWithAttributes('ola', { name: 'Ola Karisen' });
  const per = db.addWithAttributes('per', { name: 'Per Olsen' });
  const andre = db.addWithAttributes('andre', { name: 'André Lie' });
  const peder = db.addWithAttributes('peder', { name: 'Peder Hansen' });
  return [kari, ola, per, kari, andre, peder];
}

test('profileSuggestions matches the start of the name only', () => {
  const persons = makeSuggestionPersons();
  const names = (query) =>
    profileSuggestions(query, persons, new Set()).map((p) => p.name());
  expect(names('kari')).toEqual(['Kari Nilsdtr Nærum']);
  expect(names('  KARI   nils')).toEqual(['Kari Nilsdtr Nærum']);
  expect(names('ANDRE')).toEqual(['André Lie']);
  expect(names('kari naerum')).toEqual([]);
  expect(names('nærum')).toEqual([]);
  expect(names('lie')).toEqual([]);
  expect(names('  ')).toEqual([]);
});

test('profileSuggestions skips given ids and keeps to the limit', () => {
  const persons = makeSuggestionPersons();
  const ids = (query, skip, limit) =>
    profileSuggestions(query, persons, new Set(skip), limit).map((p) => p.id());
  expect(ids('pe', [])).toEqual(['peder', 'per']);
  expect(ids('pe', ['peder'])).toEqual(['per']);
  expect(ids('pe', [], 1)).toEqual(['peder']);
});

test('suggestionText shows the name and birth year', () => {
  const [kari, ola] = makeSuggestionPersons();
  expect(suggestionText(kari)).toBe('Kari Nilsdtr Nærum (1790)');
  expect(suggestionText(ola)).toBe('Ola Karisen');
});
