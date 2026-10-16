import { Person, Database } from './database.js';

test('No crash when creating a database', () => {
  let db = new Database();
  expect(db.size()).toBe(0);
});

test('Putting a person in and getting it back out works', () => {
  let db = new Database();
  db.addWithAttributes('id', { id: 'id', name: 'name' });
  const person = db.get('id');
  expect(person.name()).toBe('name');
  expect(person.id()).toBe('id');
});

test('sizeView is called with the new size when entries are added', () => {
  let db = new Database();
  const sizes = [];
  db.sizeView = size => sizes.push(size);
  db.addWithAttributes('id1', { id: 'id1', name: 'one' });
  db.addWithAttributes('id2', { id: 'id2', name: 'two' });
  expect(sizes).toStrictEqual([1, 2]);
});

test('Save and restore to string works', () => {
  let db = new Database();
  db.addWithAttributes('id', { id: 'id', name: 'name' });
  const saved = db.toJsonString();
  const db2 = new Database();
  db2.fromJsonString(saved);
  const person = db2.get('id');
  expect(person.name()).toBe('name');
  expect(person.id()).toBe('id');
});

test('Save and restore to string works with parent extras', () => {
  let db = new Database();
  const entry = db.addWithAttributes('id', { id: 'id', name: 'name' });
  entry.parents = ['random'];
  const saved = db.toJsonString();
  console.log(saved);
  const db2 = new Database();
  db2.fromJsonString(saved);
  const person = db2.get('id');
  expect(person.name()).toBe('name');
  expect(person.id()).toBe('id');
  expect(person.parents).toStrictEqual(['random']);
});

test('createAncestors picks up parent links added after an earlier run', () => {
  const db = new Database();
  db.addWithAttributes('gf', { name: 'Grandfather' });
  const father = db.addWithAttributes('f', { name: 'Father' });
  const child = db.addWithAttributes('c', { name: 'Child', father: 'f' });
  db.createAncestors();
  expect([...child.ancestors()]).toStrictEqual(['f']);

  father.setFather('gf');
  db.createAncestors();
  expect([...father.ancestors()]).toStrictEqual(['gf']);
  expect([...child.ancestors()].sort()).toStrictEqual(['f', 'gf']);
});

test('ancestorIds follows parent links that are in the database', () => {
  const db = new Database();
  db.addWithAttributes('gf', { name: 'Grandfather' });
  db.addWithAttributes('f', { name: 'Father', father: 'gf' });
  // The mother's record is missing, so she is not counted.
  const child = db.addWithAttributes('c', { name: 'Child', father: 'f',
                                            mother: 'missing' });
  db.createAncestors();
  expect([...db.ancestorIds('c')].sort()).toStrictEqual(['f', 'gf']);
  expect(db.ancestorIds('c')).toStrictEqual(child.ancestors());
  expect(db.ancestorIds('gf').size).toBe(0);
  expect(db.ancestorIds('unknown').size).toBe(0);
});

test('ancestorIds sees links added after the ancestor sets were built', () => {
  const db = new Database();
  db.addWithAttributes('m', { name: 'Mother' });
  const child = db.addWithAttributes('c', { name: 'Child' });
  db.createAncestors();
  child.setMother('m');
  expect(child.ancestors().size).toBe(0);
  expect([...db.ancestorIds('c')]).toStrictEqual(['m']);
});

test('ancestorIds counts shared ancestors once', () => {
  const db = new Database();
  db.addWithAttributes('a', { name: 'Shared ancestor' });
  db.addWithAttributes('f', { name: 'Father', father: 'a' });
  db.addWithAttributes('m', { name: 'Mother', father: 'a' });
  db.addWithAttributes('c', { name: 'Child', father: 'f', mother: 'm' });
  expect([...db.ancestorIds('c')].sort()).toStrictEqual(['a', 'f', 'm']);
});

test('ancestorGenerations counts generations by the shortest path', () => {
  const db = new Database();
  db.addWithAttributes('a', { name: 'Shared ancestor' });
  db.addWithAttributes('gf', { name: 'Grandfather', father: 'a' });
  db.addWithAttributes('f', { name: 'Father', father: 'gf' });
  db.addWithAttributes('m', { name: 'Mother', father: 'a' });
  const child = db.addWithAttributes('c', { name: 'Child', father: 'f',
                                            mother: 'm' });
  expect(child.ancestorGenerations().size).toBe(0);
  db.createAncestors();
  // 'a' is 3 generations back through the father, 2 through the mother.
  expect(child.ancestorGenerations()).toStrictEqual(
    new Map([['f', 1], ['gf', 2], ['a', 2], ['m', 1]]));
  expect(new Set(child.ancestorGenerations().keys()))
    .toStrictEqual(child.ancestors());
});

test('Completeness index counts parents and their indexes', () => {
  const db = new Database();
  db.addWithAttributes('gf', { name: 'Grandfather' });
  db.addWithAttributes('f', { name: 'Father', father: 'gf' });
  db.addWithAttributes('m', { name: 'Mother' });
  const child = db.addWithAttributes('c', { name: 'Child', father: 'f', mother: 'm' });
  // Father: 0.25. Child: 0.25 + 0.25 + 0.25 * 0.25.
  db.createAncestors();
  expect(db.get('f').completenessIndex()).toBe(0.25);
  expect(child.completenessIndex()).toBe(0.5625);
  expect(db.completenessIndex('c')).toBe(0.5625);
  expect(db.completenessIndex('gf')).toBe(0);
});

test('Completeness index ignores links to persons not in the database', () => {
  const db = new Database();
  const child = db.addWithAttributes('c', { name: 'Child', father: 'missing' });
  db.createAncestors();
  expect(child.completenessIndex()).toBe(0);
  expect(db.completenessIndex('c')).toBe(0);
});
