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
