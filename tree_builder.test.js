import { jest } from '@jest/globals';
import { Database } from './database.js';
import { FakeGeniClient } from './fake_geni_client.js';
import { TreeBuilder } from './tree_builder.js';

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Four generations on the fake Geni: Child (1) with parents 2 and 3;
// 2's parents 4 and 5, who also have a daughter 9, mother of Cousin (8);
// 4's parents 6 and 7, born before the year limit used in the tests.
function makeGeni() {
  const geni = new FakeGeniClient();
  geni.person(1, 'Child', 'female', 1950);
  geni.person(2, 'Father', 'male', 1920);
  geni.person(3, 'Mother', 'female', 1922);
  geni.person(4, 'Grandfather', 'male', 1890);
  geni.person(5, 'Grandmother', 'female', 1892);
  geni.person(6, 'Great-grandfather', 'male', 1860);
  geni.person(7, 'Great-grandmother', 'female', 1862);
  geni.person(8, 'Cousin', 'male', 1952);
  geni.person(9, 'Aunt', 'female', 1925);
  geni.union(10, [2, 3], [1]);
  geni.union(11, [4, 5], [2, 9]);
  geni.union(12, [6, 7], [4]);
  geni.union(13, [9], [8]);
  return geni;
}

const yearLimit = 1880;

function makeBuilder(geni, db = new Database()) {
  const hooks = {
    onSurprise: jest.fn(),
    onMerge: jest.fn(),
    onMessage: jest.fn()
  };
  return { db, hooks, builder: new TreeBuilder(geni, db, hooks) };
}

// Add the profile with the guid and build its tree.
async function addAndBuild(builder, guid) {
  const person = await builder.fetchProfileToAdd(guid);
  await builder.buildTreeForPerson(person, 2025, yearLimit);
  return person;
}

test('buildTreeForPerson links parents by gender back to the year limit', async () => {
  const geni = makeGeni();
  const { db, hooks, builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g1');
  expect(db.get('g1').father()).toBe('g2');
  expect(db.get('g1').mother()).toBe('g3');
  expect(db.get('g4').father()).toBe('g6');
  // 6 and 7 are born before the limit, so their parents are not looked for.
  expect(db.get('g6').parents).toBeUndefined();
  expect(db.ancestorIds('g1'))
    .toStrictEqual(new Set(['g2', 'g3', 'g4', 'g5', 'g6', 'g7']));
  expect(hooks.onSurprise).not.toHaveBeenCalled();
});

test('buildTreeForPerson stops after the generations asked for', async () => {
  const geni = makeGeni();
  const { db, builder } = makeBuilder(geni);
  const person = await builder.fetchProfileToAdd('g1');
  await builder.buildTreeForPerson(person, 2025, -Infinity, 1);
  expect(db.ancestorIds('g1')).toStrictEqual(new Set(['g2', 'g3']));
});

test('buildTreeForPerson does not fetch profiles already known', async () => {
  const geni = makeGeni();
  const { builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g1');
  geni.requests = [];
  await addAndBuild(builder, 'g8');
  expect(geni.profileFetches('g4')).toBe(0);
  expect(geni.profileFetches('g9')).toBe(1);
});

test('fetchProfileToAdd uses the database, and follows merges', async () => {
  const geni = makeGeni();
  geni.person(20, 'Other', 'male', 1900);
  const { db, hooks, builder } = makeBuilder(geni);
  const child = await builder.fetchProfileToAdd('g1');
  expect(child.name()).toBe('Child');
  expect(await builder.fetchProfileToAdd('g1')).toBe(child);
  expect(geni.profileFetches('g1')).toBe(1);
  expect(await builder.fetchProfileToAdd('g99')).toBeUndefined();
  geni.person(21, 'Other', 'male', 1900);
  geni.merge(21, 20);
  const merged = await builder.fetchProfileToAdd('g21');
  expect(merged.id()).toBe('g20');
  expect(db.get('g20')).toBe(merged);
  expect(hooks.onSurprise).not.toHaveBeenCalled();
});

test('rebuild uses a gender corrected on Geni', async () => {
  const geni = makeGeni();
  const { db, hooks, builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g1');
  // The stored record of the mother has the wrong gender.
  const mother = db.get('g3');
  db.updateAttributes('g3', { ...mother.toJSON().attributes,
                              gender: 'male' });
  await builder.rebuild(db.get('g1'), yearLimit);
  expect(hooks.onSurprise).not.toHaveBeenCalled();
  expect(db.get('g3').gender()).toBe('female');
  expect(db.get('g1').father()).toBe('g2');
  expect(db.get('g1').mother()).toBe('g3');
});

test('rebuild picks up a parent added on Geni', async () => {
  const geni = makeGeni();
  const { db, builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g8');
  expect(db.get('g9').father()).toBe('g4');
  geni.person(14, 'Uncle by marriage', 'male', 1924);
  geni.union(15, [14, 9], [8]);
  // The cousin's birth union is now the one with both parents.
  geni.edit(8, 'unions', ['https://www.geni.com/api/union-15']);
  await builder.rebuild(db.get('g8'), yearLimit);
  expect(db.get('g8').father()).toBe('g14');
  expect(db.get('g8').mother()).toBe('g9');
});

test('rebuilds running at once fetch shared ancestors once', async () => {
  const geni = makeGeni();
  const { db, builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g1');
  await addAndBuild(builder, 'g8');
  geni.requests = [];
  await Promise.all([builder.rebuild(db.get('g1'), yearLimit),
                     builder.rebuild(db.get('g8'), yearLimit)]);
  for (const guid of ['g1', 'g2', 'g4', 'g5', 'g8', 'g9']) {
    expect(geni.profileFetches(guid)).toBe(1);
  }
  // Parents beyond the year limit are fetched for their gender only.
  expect(geni.profileFetches('g6')).toBe(1);
});

test('rebuild keeps the parent links if fetching the unions fails', async () => {
  const geni = makeGeni();
  const { db, hooks, builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g1');
  geni.failingUnions.add('union-11');
  await builder.rebuild(db.get('g1'), yearLimit);
  expect(db.get('g2').father()).toBe('g4');
  expect(db.get('g2').parents).toHaveLength(2);
  expect(db.ancestorIds('g1').size).toBe(6);
  expect(hooks.onSurprise).not.toHaveBeenCalled();
});

test('rebuild keeps the tree when stopped', async () => {
  const geni = makeGeni();
  const { db, builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g1');
  geni.stop();
  await builder.rebuild(db.get('g1'), yearLimit);
  expect(db.ancestorIds('g1').size).toBe(6);
  // The pool is emptied, so the next rebuild starts afresh.
  geni.start();
  geni.requests = [];
  await builder.rebuild(db.get('g1'), yearLimit);
  expect(geni.profileFetches('g1')).toBe(1);
});

test('rebuild records a merge found on Geni', async () => {
  const geni = makeGeni();
  const { db, hooks, builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g1');
  geni.person(21, 'Father', 'male', 1920);
  geni.merge(2, 21);
  await builder.rebuild(db.get('g2'), yearLimit);
  expect(hooks.onMerge).toHaveBeenCalledWith('g2', 'g21');
  expect(db.get('g2').id()).toBe('g21');
  expect(db.get('g1').father()).toBe('g21');
  expect(db.get('g21').father()).toBe('g4');
  expect(hooks.onSurprise).not.toHaveBeenCalled();
});

test('rebuild reports two fathers and stops fetching', async () => {
  const geni = makeGeni();
  const { db, hooks, builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g1');
  geni.edit(3, 'gender', 'male');
  await builder.rebuild(db.get('g1'), yearLimit);
  expect(hooks.onSurprise).toHaveBeenCalledWith(
    'two fathers', 'Child (g1)', expect.any(Array));
  expect(geni.stopped).toBe(true);
});

test('surprise details use the name hook', async () => {
  const geni = makeGeni();
  const db = new Database();
  const onSurprise = jest.fn();
  const builder = new TreeBuilder(geni, db, {
    onSurprise, name: person => person.name()[0] + '.'
  });
  await addAndBuild(builder, 'g1');
  geni.edit(3, 'gender', 'male');
  await builder.rebuild(db.get('g1'), yearLimit);
  expect(onSurprise.mock.calls[0][1]).toBe('C. (g1)');
});

test('a rebuild that refreshes nothing does not block later ones', async () => {
  const geni = makeGeni();
  const { db, builder } = makeBuilder(geni);
  await addAndBuild(builder, 'g1');
  // Born before the year limit, so nothing is refreshed.
  await builder.rebuild(db.get('g6'), yearLimit);
  geni.requests = [];
  await builder.rebuild(db.get('g1'), yearLimit);
  expect(geni.profileFetches('g1')).toBe(1);
});
