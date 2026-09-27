import { Database } from './database.js';
import { GroupStore } from './groups.js';
import { FakeStorage } from './fake_storage.js';
import {
  exportToJsonString,
  parseExport,
  applyImport
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
