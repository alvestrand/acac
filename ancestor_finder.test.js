import { Database } from './database.js';
import {
  scoringAlgorithms,
  groupingAlgorithms,
  makeGroupList,
  makeRootDescendantGroups,
} from './ancestor_finder.js';

// X and Y are first cousins: their fathers share the parents g1 and g2.
// Y and Z are distantly related: they share a2 and its line a3, a4,
// 3 and 4 generations back. Z has no known common ancestor with X.
function cousinsAndDistantRelative() {
  const db = new Database();
  const add = (id, father, mother) =>
    db.addWithAttributes(id, { name: id, father: father, mother: mother });
  add('g1');
  add('g2');
  add('xf', 'g1', 'g2');
  add('yf', 'g1', 'g2');
  add('a4');
  add('a3', 'a4');
  add('a2', 'a3');
  add('a1', 'a2');
  add('ym', 'a1');
  add('z3', 'a2');
  add('z2', 'z3');
  add('zf', 'z2');
  add('X', 'xf');
  add('Y', 'yf', 'ym');
  add('Z', 'zf');
  add('N'); // No known ancestors
  db.createAncestors();
  return db;
}

function memberIds(groupList) {
  return groupList.map((group) => group.persons.map((person) => person.id()));
}

test('sharedAncestors is the default, and groups by number of ancestors', () => {
  const db = cousinsAndDistantRelative();
  const persons = ['X', 'Y', 'Z', 'N'].map((id) => db.get(id));
  // Y and Z share 3 ancestors, X and Y only 2.
  const groups = makeGroupList(persons);
  expect(memberIds(groups)).toStrictEqual([['X'], ['Y', 'Z'], ['N']]);
  expect(
    memberIds(makeGroupList(persons, scoringAlgorithms.sharedAncestors)),
  ).toStrictEqual(memberIds(groups));
  expect(groups[1].ancestors).toStrictEqual(new Set(['a2', 'a3', 'a4']));
});

test('kinship and closestAncestor group the close relatives', () => {
  const db = cousinsAndDistantRelative();
  const persons = ['X', 'Y', 'Z', 'N'].map((id) => db.get(id));
  for (const score of [
    scoringAlgorithms.kinship,
    scoringAlgorithms.closestAncestor,
  ]) {
    const groups = makeGroupList(persons, score);
    expect(memberIds(groups)).toStrictEqual([['X', 'Y'], ['Z'], ['N']]);
    expect(groups[0].ancestors).toStrictEqual(new Set(['g1', 'g2']));
  }
});

test('A merged group keeps the generations of its farthest member', () => {
  const db = cousinsAndDistantRelative();
  const groups = makeGroupList([db.get('Y'), db.get('Z')]);
  expect(groups[0].generations).toStrictEqual(
    new Map([
      ['a2', 4],
      ['a3', 5],
      ['a4', 6],
    ]),
  );
});

test('Scores for the example', () => {
  const db = cousinsAndDistantRelative();
  const [x, y, z] = makeGroupList([db.get('X')]).concat(
    makeGroupList([db.get('Y')]),
    makeGroupList([db.get('Z')]),
  );
  expect(scoringAlgorithms.sharedAncestors(x, y)).toBe(2);
  expect(scoringAlgorithms.sharedAncestors(y, z)).toBe(3);
  expect(scoringAlgorithms.kinship(x, y)).toBe(2 * 2 ** -4);
  expect(scoringAlgorithms.kinship(y, z)).toBe(2 ** -7 + 2 ** -9 + 2 ** -11);
  expect(scoringAlgorithms.closestAncestor(y, z)).toBe(2 ** -7);
  expect(scoringAlgorithms.kinship(x, z)).toBe(0);
});

test('rootDescendants groups the descendants of the most shared root', () => {
  const db = cousinsAndDistantRelative();
  // g1 and g2 have X and Y as descendants, a4 has Y and Z: the tie goes
  // to g1, found first. Z is left with no one to share a root with.
  const groups = makeRootDescendantGroups(
    ['X', 'Y', 'Z', 'N'].map((id) => db.get(id)),
    db,
  );
  expect(memberIds(groups)).toStrictEqual([['X', 'Y'], ['Z'], ['N']]);
  expect(groups[0].ancestors).toStrictEqual(new Set(['g1', 'g2']));
  expect(groups[0].generations).toStrictEqual(
    new Map([
      ['g1', 2],
      ['g2', 2],
    ]),
  );
});

test('rootDescendants takes the root with most descendants, then repeats', () => {
  const db = cousinsAndDistantRelative();
  // V descends from g1, which then has three descendants. W and U also
  // descend from a4, which then has four, and takes Y. After that, V
  // shares the root g1 with X.
  db.addWithAttributes('V', { name: 'V', father: 'g1' });
  db.addWithAttributes('W', { name: 'W', father: 'z2' });
  db.addWithAttributes('U', { name: 'U', father: 'zf' });
  db.createAncestors();
  const persons = ['X', 'Y', 'Z', 'N', 'V', 'W', 'U'].map((id) => db.get(id));
  const groups = groupingAlgorithms.rootDescendants(persons, db);
  expect(memberIds(groups)).toStrictEqual([
    ['Y', 'Z', 'W', 'U'],
    ['X', 'V'],
    ['N'],
  ]);
  expect(groups[0].ancestors).toStrictEqual(new Set(['a2', 'a3', 'a4']));
  expect(groups[1].ancestors).toStrictEqual(new Set(['g1']));
});

test('groupingAlgorithms has one entry per scoring algorithm', () => {
  const db = cousinsAndDistantRelative();
  const persons = ['X', 'Y', 'Z', 'N'].map((id) => db.get(id));
  for (const [name, score] of Object.entries(scoringAlgorithms)) {
    expect(memberIds(groupingAlgorithms[name](persons, db))).toStrictEqual(
      memberIds(makeGroupList(persons, score)),
    );
  }
});

test('sharedAncestorsCompleteness merges the most complete profile first', () => {
  const db = new Database();
  const add = (id, father, mother) =>
    db.addWithAttributes(id, { name: id, father: father, mother: mother });
  for (const id of ['s', 't', 'v', 'w', 'x', 'y']) {
    add(id);
  }
  // P has the most complete tree, and shares s with R. Q shares v and w
  // with R, so the highest scoring pair is Q and R.
  add('p1', 's', 't');
  add('p2', 'x', 'y');
  add('P', 'p1', 'p2');
  add('r1', 's');
  add('u1', 'v', 'w');
  add('R', 'r1', 'u1');
  add('q1', 'v', 'w');
  add('Q', 'q1');
  db.createAncestors();
  expect(db.get('P').completenessIndex()).toBe(0.75);
  expect(db.get('R').completenessIndex()).toBe(0.6875);
  expect(db.get('Q').completenessIndex()).toBe(0.375);
  const persons = ['P', 'Q', 'R'].map((id) => db.get(id));
  expect(
    memberIds(groupingAlgorithms.sharedAncestors(persons, db)),
  ).toStrictEqual([['P'], ['Q', 'R']]);
  const groups = groupingAlgorithms.sharedAncestorsCompleteness(persons, db);
  expect(memberIds(groups)).toStrictEqual([['P', 'R'], ['Q']]);
  expect(groups[0].ancestors).toStrictEqual(new Set(['s']));
});

test('groupingAlgorithms has a completeness variant per scoring algorithm', () => {
  const db = cousinsAndDistantRelative();
  const persons = ['X', 'Y', 'Z', 'N'].map((id) => db.get(id));
  for (const name of Object.keys(scoringAlgorithms)) {
    expect(groupingAlgorithms).toHaveProperty(name + 'Completeness');
  }
  // Y is the most complete, and the scores pick its partner.
  expect(
    memberIds(groupingAlgorithms.sharedAncestorsCompleteness(persons, db)),
  ).toStrictEqual([['X'], ['Y', 'Z'], ['N']]);
  expect(
    memberIds(groupingAlgorithms.kinshipCompleteness(persons, db)),
  ).toStrictEqual([['Y', 'X'], ['Z'], ['N']]);
});
