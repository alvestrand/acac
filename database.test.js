import { Person, Database } from './database.js';

test('No crash when creating a database', () => {
  let db = new Database();
  expect(db.size()).toBe(0);
});
