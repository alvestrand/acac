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
