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
