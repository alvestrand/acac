import { Database } from './database.js';
import { scoringAlgorithms, makeGroupList } from './ancestor_finder.js';

// X and Y are first cousins: their fathers share the parents g1 and g2.
// Y and Z are distantly related: they share a2 and its line a3, a4,
// 3 and 4 generations back. Z has no known common ancestor with X.
function cousinsAndDistantRelative() {
  const db = new Database();
  const add = (id, father, mother) => db.addWithAttributes(
    id, { name: id, father: father, mother: mother });
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
  add('N');  // No known ancestors
  db.createAncestors();
  return db;
}

function memberIds(groupList) {
  return groupList.map(group => group.persons.map(person => person.id()));
}

test('sharedAncestors is the default, and groups by number of ancestors', () => {
  const db = cousinsAndDistantRelative();
  const persons = ['X', 'Y', 'Z', 'N'].map(id => db.get(id));
  // Y and Z share 3 ancestors, X and Y only 2.
  const groups = makeGroupList(persons);
  expect(memberIds(groups)).toStrictEqual([['X'], ['Y', 'Z'], ['N']]);
  expect(memberIds(makeGroupList(persons,
                                 scoringAlgorithms.sharedAncestors)))
    .toStrictEqual(memberIds(groups));
  expect(groups[1].ancestors).toStrictEqual(new Set(['a2', 'a3', 'a4']));
});

test('kinship and closestAncestor group the close relatives', () => {
  const db = cousinsAndDistantRelative();
  const persons = ['X', 'Y', 'Z', 'N'].map(id => db.get(id));
  for (const score of [scoringAlgorithms.kinship,
                       scoringAlgorithms.closestAncestor]) {
    const groups = makeGroupList(persons, score);
    expect(memberIds(groups)).toStrictEqual([['X', 'Y'], ['Z'], ['N']]);
    expect(groups[0].ancestors).toStrictEqual(new Set(['g1', 'g2']));
  }
});

test('A merged group keeps the generations of its farthest member', () => {
  const db = cousinsAndDistantRelative();
  const groups = makeGroupList([db.get('Y'), db.get('Z')]);
  expect(groups[0].generations).toStrictEqual(
    new Map([['a2', 4], ['a3', 5], ['a4', 6]]));
});

test('Scores for the example', () => {
  const db = cousinsAndDistantRelative();
  const [x, y, z] = makeGroupList([db.get('X')]).concat(
    makeGroupList([db.get('Y')]), makeGroupList([db.get('Z')]));
  expect(scoringAlgorithms.sharedAncestors(x, y)).toBe(2);
  expect(scoringAlgorithms.sharedAncestors(y, z)).toBe(3);
  expect(scoringAlgorithms.kinship(x, y)).toBe(2 * 2 ** -4);
  expect(scoringAlgorithms.kinship(y, z)).toBe(2 ** -7 + 2 ** -9 + 2 ** -11);
  expect(scoringAlgorithms.closestAncestor(y, z)).toBe(2 ** -7);
  expect(scoringAlgorithms.kinship(x, z)).toBe(0);
});
