import { Database } from './database.js';
import {
  storedGroups,
  exportToJsonString,
  parseExport,
  applyImport
} from './file_export.js';

// Minimal in-memory implementation of the Storage interface.
class FakeStorage {
  #items = new Map();
  get length() {
    return this.#items.size;
  }
  key(index) {
    return [...this.#items.keys()][index] ?? null;
  }
  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }
  setItem(key, value) {
    this.#items.set(key, String(value));
  }
  removeItem(key) {
    this.#items.delete(key);
  }
}

function makeSourceState() {
  const db = new Database();
  const father = db.addWithAttributes('g1', { id: 'profile-1', name: 'Father' });
  const child = db.addWithAttributes('g2', { id: 'profile-2', name: 'Child' });
  child.setFather('g1');
  child.parents = ['https://www.geni.com/api/profile-1'];
  const storage = new FakeStorage();
  storage.setItem('profileSet-saved', JSON.stringify([father]));
  storage.setItem('unrelated', 'keep me');
  return { db, storage, father, child };
}

test('storedGroups returns only profile sets', () => {
  const { storage } = makeSourceState();
  const groups = storedGroups(storage);
  expect(Object.keys(groups)).toStrictEqual(['saved']);
  expect(groups.saved[0].id).toBe('g1');
});

test('Export and import round trip restores persons and groups', () => {
  const { db, storage, child } = makeSourceState();
  const exported = exportToJsonString(db, storage, 'current', [child]);

  const db2 = new Database();
  const storage2 = new FakeStorage();
  const currentGroup = applyImport(parseExport(exported), db2, storage2);

  expect(currentGroup).toBe('current');
  expect(storage2.getItem('currentSet')).toBe('current');
  expect(db2.size()).toBe(2);
  const restoredChild = db2.get('g2');
  expect(restoredChild.name()).toBe('Child');
  expect(restoredChild.father()).toBe('g1');
  expect(restoredChild.parents).toStrictEqual(
    ['https://www.geni.com/api/profile-1']);
  expect(db2.getByIdAttribute('profile-1').name()).toBe('Father');

  const groups = storedGroups(storage2);
  expect(Object.keys(groups).sort()).toStrictEqual(['current', 'saved']);
  expect(groups.saved.map(p => p.id)).toStrictEqual(['g1']);
  expect(groups.current.map(p => p.id)).toStrictEqual(['g2']);
});

test('Export includes current group even when not in storage', () => {
  const { db, child } = makeSourceState();
  const exported = exportToJsonString(db, new FakeStorage(), 'unsaved', [child]);
  const parsed = parseExport(exported);
  expect(Object.keys(parsed.groups)).toStrictEqual(['unsaved']);
  expect(parsed.currentGroup).toBe('unsaved');
});

test('Import replaces existing persons and groups', () => {
  const { db, storage, child } = makeSourceState();
  const exported = exportToJsonString(db, storage, 'current', [child]);

  const db2 = new Database();
  db2.addWithAttributes('old', { id: 'profile-old', name: 'Old' });
  const storage2 = new FakeStorage();
  storage2.setItem('profileSet-stale', '[]');
  storage2.setItem('unrelated', 'keep me');
  applyImport(parseExport(exported), db2, storage2);

  expect(db2.get('old')).toBeUndefined();
  expect(db2.getByIdAttribute('profile-old')).toBeUndefined();
  expect(db2.size()).toBe(2);
  expect(storage2.getItem('profileSet-stale')).toBeNull();
  expect(storage2.getItem('unrelated')).toBe('keep me');
});

test('parseExport rejects invalid JSON', () => {
  expect(() => parseExport('not json')).toThrow();
});

test('parseExport rejects JSON that is not an export', () => {
  expect(() => parseExport('null')).toThrow('Not a saved database');
  expect(() => parseExport('{"persons": {}}')).toThrow('Not a saved database');
  expect(() => parseExport('{"groups": {}}')).toThrow('Not a saved database');
});
