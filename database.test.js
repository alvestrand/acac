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

test('updateAttributes replaces the record but keeps the object and links', () => {
  const db = new Database();
  const person = db.addWithAttributes('g1', {
    id: 'profile-1', name: 'Old', gender: 'male', father: 'f',
    birth: {date: {year: 1900}}});
  db.addWithAttributes('f', { id: 'profile-2' });
  person.parents = ['url'];
  const updated = db.updateAttributes('g1', {
    id: 'profile-1', name: 'New', gender: 'female',
    birth: {date: {year: 1901}}});
  expect(updated).toBe(person);
  expect(db.get('g1')).toBe(person);
  expect(db.getByIdAttribute('profile-1')).toBe(person);
  expect(person.name()).toBe('New');
  expect(person.gender()).toBe('female');
  expect(person.birth()).toBe(1901);
  // Parent links are kept until the caller sets new ones, so that the
  // tree stays whole while a rebuild fetches the parents again.
  expect(person.father()).toBe('f');
  expect(person.mother()).toBeUndefined();
  expect(person.attribute('father')).toBe('f');
  expect(db.ancestorIds('g1')).toStrictEqual(new Set(['f']));
  // The public parents property is left to the caller.
  expect(person.parents).toStrictEqual(['url']);
});

test('merge moves links to the new person and keeps the old id working', () => {
  const db = new Database();
  db.addWithAttributes('old', { id: 'profile-1', name: 'Old' });
  const current = db.addWithAttributes('new', { id: 'profile-2', name: 'New' });
  const child1 = db.addWithAttributes('c1', { id: 'profile-3', father: 'old' });
  child1.parents = ['https://www.geni.com/api/profile-1',
                    'https://www.geni.com/api/profile-9'];
  const child2 = db.addWithAttributes('c2', { id: 'profile-4', father: 'new' });
  expect(db.merge('old', 'new')).toBe(1);
  expect(child1.father()).toBe('new');
  expect(child1.parents).toStrictEqual(['https://www.geni.com/api/profile-2',
                                        'https://www.geni.com/api/profile-9']);
  expect(db.size()).toBe(3);
  expect(db.get('old')).toBe(current);
  expect(db.getByIdAttribute('profile-1')).toBe(current);
  expect(db.currentId('old')).toBe('new');
  expect(db.isMerged('old')).toBe(true);
  // Both children now share the ancestor.
  db.createAncestors();
  expect([...child1.ancestors()]).toStrictEqual(['new']);
  expect([...child2.ancestors()]).toStrictEqual(['new']);
});

test('merge follows earlier merges into the merged person', () => {
  const db = new Database();
  db.addWithAttributes('b', { id: 'profile-2' });
  db.addWithAttributes('c', { id: 'profile-3' });
  db.merge('a', 'b');
  db.merge('b', 'c');
  expect(db.currentId('a')).toBe('c');
  expect(db.get('a').id()).toBe('c');
});

test('merge does nothing without the new person', () => {
  const db = new Database();
  const old = db.addWithAttributes('old', { id: 'profile-1' });
  expect(db.merge('old', 'missing')).toBe(0);
  expect(db.get('old')).toBe(old);
  expect(db.isMerged('old')).toBe(false);
});

test('merges are saved and restored', () => {
  const db = new Database();
  db.addWithAttributes('new', { id: 'profile-2' });
  db.merge('old', 'new');
  const db2 = new Database();
  db2.fromJsonString(db.toJsonString());
  expect(db2.get('old').id()).toBe('new');
});
