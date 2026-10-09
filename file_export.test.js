import { Database } from './database.js';
import { GroupStore } from './groups.js';
import { FakeStorage } from './fake_storage.js';
import {
  exportToJsonString,
  parseExport,
  applyImport,
  exportGroupToJsonString,
  parseGroupExport,
  mergeGroupImport
} from './file_export.js';

function makeSourceState() {
  const db = new Database();
  const father = db.addWithAttributes('g1', { id: 'profile-1', name: 'Father' });
  const child = db.addWithAttributes('g2', { id: 'profile-2', name: 'Child' });
  child.setFather('g1');
  child.parents = ['https://www.geni.com/api/profile-1'];
  const storage = new FakeStorage();
  // Stored the way older versions did it, with whole person records.
  storage.setItem('profileSet-saved', JSON.stringify([father]));
  storage.setItem('profileSet-ids', JSON.stringify(['g2']));
  storage.setItem('unrelated', 'keep me');
  return { db, groupStore: new GroupStore(storage), father };
}

test('Export and import round trip restores persons and groups', () => {
  const { db, groupStore } = makeSourceState();
  const exported = exportToJsonString(db, groupStore, 'current', ['g2']);

  const db2 = new Database();
  const storage2 = new FakeStorage();
  const groupStore2 = new GroupStore(storage2);
  const currentGroup = applyImport(parseExport(exported), db2, groupStore2);

  expect(currentGroup).toBe('current');
  expect(groupStore2.currentName()).toBe('current');
  expect(db2.size()).toBe(2);
  const restoredChild = db2.get('g2');
  expect(restoredChild.name()).toBe('Child');
  expect(restoredChild.father()).toBe('g1');
  expect(restoredChild.parents).toStrictEqual(
    ['https://www.geni.com/api/profile-1']);
  expect(db2.getByIdAttribute('profile-1').name()).toBe('Father');

  const groups = groupStore2.groups();
  expect(Object.keys(groups).sort()).toStrictEqual(['current', 'ids', 'saved']);
  expect(groups.saved).toStrictEqual(['g1']);
  expect(groups.current).toStrictEqual(['g2']);
  expect(JSON.parse(storage2.getItem('profileSet-saved'))).toStrictEqual(['g1']);
});

test('Export includes current group even when not in storage', () => {
  const { db } = makeSourceState();
  const exported = exportToJsonString(db, new GroupStore(new FakeStorage()),
                                      'unsaved', ['g2']);
  const parsed = parseExport(exported);
  expect(Object.keys(parsed.groups)).toStrictEqual(['unsaved']);
  expect(parsed.currentGroup).toBe('unsaved');
});

test('Import replaces existing persons and groups', () => {
  const { db, groupStore } = makeSourceState();
  const exported = exportToJsonString(db, groupStore, 'current', ['g2']);

  const db2 = new Database();
  db2.addWithAttributes('old', { id: 'profile-old', name: 'Old' });
  const storage2 = new FakeStorage();
  storage2.setItem('profileSet-stale', '[]');
  storage2.setItem('unrelated', 'keep me');
  applyImport(parseExport(exported), db2, new GroupStore(storage2));

  expect(db2.get('old')).toBeUndefined();
  expect(db2.getByIdAttribute('profile-old')).toBeUndefined();
  expect(db2.size()).toBe(2);
  expect(storage2.getItem('profileSet-stale')).toBeNull();
  expect(storage2.getItem('unrelated')).toBe('keep me');
});

test('Exported groups contain only ids', () => {
  const { db, groupStore } = makeSourceState();
  const parsed = parseExport(
    exportToJsonString(db, groupStore, 'current', ['g2']));
  expect(parsed.groups).toStrictEqual({
    saved: ['g1'],
    ids: ['g2'],
    current: ['g2']
  });
});

test('Import accepts files with whole person records in groups', () => {
  const { db, father } = makeSourceState();
  const oldFormat = JSON.stringify({
    ...db.toJsonObject(),
    groups: { old: [father] },
    currentGroup: 'old'
  });
  const storage2 = new FakeStorage();
  applyImport(parseExport(oldFormat), new Database(), new GroupStore(storage2));
  expect(JSON.parse(storage2.getItem('profileSet-old'))).toStrictEqual(['g1']);
});

test('parseExport rejects invalid JSON', () => {
  expect(() => parseExport('not json')).toThrow();
});

test('parseExport rejects JSON that is not an export', () => {
  expect(() => parseExport('null')).toThrow('Not a saved database');
  expect(() => parseExport('{"persons": {}}')).toThrow('Not a saved database');
  expect(() => parseExport('{"groups": {}}')).toThrow('Not a saved database');
});

function makeFamily() {
  const db = new Database();
  db.addWithAttributes('gf', { id: 'profile-gf', name: 'Grandfather' });
  db.addWithAttributes('f', { id: 'profile-f', name: 'Father',
                              father: 'gf' });
  db.addWithAttributes('m', { id: 'profile-m', name: 'Mother' });
  const child = db.addWithAttributes('c', { id: 'profile-c', name: 'Child',
                                            father: 'f', mother: 'm' });
  child.parents = ['https://www.geni.com/api/profile-f',
                   'https://www.geni.com/api/profile-m'];
  db.addWithAttributes('cousin', { id: 'profile-cousin', name: 'Cousin',
                                   father: 'f' });
  db.addWithAttributes('other', { id: 'profile-other', name: 'Unrelated' });
  return db;
}

test('Group export contains members and all their ancestors', () => {
  const db = makeFamily();
  const parsed = parseGroupExport(
    exportGroupToJsonString('family', ['c', 'cousin'], db));
  expect(parsed.groupName).toBe('family');
  expect(parsed.members).toStrictEqual(['c', 'cousin']);
  expect(parsed.persons.map(person => person.id).sort())
    .toStrictEqual(['c', 'cousin', 'f', 'gf', 'm']);
});

test('Group export and import round trip restores the tree', () => {
  const exported = exportGroupToJsonString('family', ['c', 'cousin'],
                                           makeFamily());
  const db = new Database();
  const result = mergeGroupImport(parseGroupExport(exported), db);

  expect(result).toStrictEqual({ ids: ['c', 'cousin'], added: 5,
                                 replaced: 0, kept: 0 });
  const child = db.get('c');
  expect(child.father()).toBe('f');
  expect(child.mother()).toBe('m');
  expect(child.parents).toStrictEqual(['https://www.geni.com/api/profile-f',
                                       'https://www.geni.com/api/profile-m']);
  expect(db.getByIdAttribute('profile-gf').name()).toBe('Grandfather');
  db.createAncestors();
  expect([...child.ancestors()].sort()).toStrictEqual(['f', 'gf', 'm']);
});

test('Group import replaces a person only if the file record is newer', () => {
  const source = new Database();
  source.addWithAttributes('newer', { name: 'Newer in file',
                                      updated_at: '200' });
  source.addWithAttributes('older', { name: 'Older in file',
                                      updated_at: '100' });
  source.addWithAttributes('same', { name: 'Same in file',
                                     updated_at: '150' });
  source.addWithAttributes('stamped', { name: 'Stamped in file',
                                        updated_at: '100' });
  source.addWithAttributes('unstamped', { name: 'Unstamped in file' });
  const exported = exportGroupToJsonString(
    'group', ['newer', 'older', 'same', 'stamped', 'unstamped'], source);

  const db = new Database();
  db.addWithAttributes('newer', { name: 'Newer in db', updated_at: '150' });
  db.addWithAttributes('older', { name: 'Older in db', updated_at: '150' });
  db.addWithAttributes('same', { name: 'Same in db', updated_at: '150' });
  db.addWithAttributes('stamped', { name: 'Unstamped in db' });
  db.addWithAttributes('unstamped', { name: 'Stamped in db',
                                      updated_at: '100' });
  const result = mergeGroupImport(parseGroupExport(exported), db);

  expect(result.replaced).toBe(2);
  expect(result.kept).toBe(3);
  expect(db.get('newer').name()).toBe('Newer in file');
  expect(db.get('older').name()).toBe('Older in db');
  expect(db.get('same').name()).toBe('Same in db');
  expect(db.get('stamped').name()).toBe('Stamped in file');
  expect(db.get('unstamped').name()).toBe('Stamped in db');
});

test('Group import keeps parent links found in only one record', () => {
  const source = new Database();
  source.addWithAttributes('f', { name: 'Father' });
  source.addWithAttributes('m', { name: 'Mother' });
  // Newer in file, but without the mother link the database has.
  source.addWithAttributes('a', { name: 'A in file', updated_at: '200',
                                  father: 'f' });
  // Older in file, but with links and parents the database lacks.
  const b = source.addWithAttributes('b', { name: 'B in file',
                                            updated_at: '100',
                                            father: 'f', mother: 'm' });
  b.parents = ['https://www.geni.com/api/profile-f'];
  const exported = exportGroupToJsonString('group', ['a', 'b'], source);

  const db = new Database();
  db.addWithAttributes('m', { name: 'Mother' });
  const a = db.addWithAttributes('a', { name: 'A in db', updated_at: '100',
                                        mother: 'm' });
  a.parents = ['https://www.geni.com/api/profile-m'];
  db.addWithAttributes('b', { name: 'B in db', updated_at: '200' });
  db.createAncestors();
  mergeGroupImport(parseGroupExport(exported), db);

  const newA = db.get('a');
  expect(newA.name()).toBe('A in file');
  expect(newA.father()).toBe('f');
  expect(newA.mother()).toBe('m');
  expect(newA.parents).toStrictEqual(['https://www.geni.com/api/profile-m']);
  const newB = db.get('b');
  expect(newB.name()).toBe('B in db');
  expect(newB.father()).toBe('f');
  expect(newB.mother()).toBe('m');
  expect(newB.attribute('father')).toBe('f');
  expect(newB.parents).toStrictEqual(['https://www.geni.com/api/profile-f']);
  // Ancestor sets built before the merge are recalculated.
  db.createAncestors();
  expect([...newB.ancestors()].sort()).toStrictEqual(['f', 'm']);
});

test('parseGroupExport rejects JSON that is not a group file', () => {
  expect(() => parseGroupExport('not json')).toThrow();
  expect(() => parseGroupExport('null')).toThrow('Not a saved group');
  expect(() => parseGroupExport('{"members": [], "persons": []}'))
    .toThrow('Not a saved group');
  expect(() => parseGroupExport('{"groupName": "g", "persons": []}'))
    .toThrow('Not a saved group');
  expect(() => parseGroupExport('{"groupName": "g", "members": [1], '
                                + '"persons": []}'))
    .toThrow('Not a saved group');
  expect(() => parseGroupExport('{"groupName": "g", "members": []}'))
    .toThrow('Not a saved group');
  expect(() => parseGroupExport('{"groupName": "g", "members": [], '
                                + '"persons": [{}]}'))
    .toThrow('Not a saved group');
  expect(() => parseGroupExport(
    '{"groupName": "g", "members": [], '
    + '"persons": [{"id": "g1", "attributes": null}]}'))
    .toThrow('Not a saved group');
  // A full database export is not a group file.
  expect(() => parseGroupExport('{"persons": {}, "groups": {}}'))
    .toThrow('Not a saved group');
});
