import { Database } from './database.js';
import { FakeStorage } from './fake_storage.js';
import { DatabaseFile } from './opfsdb.js';
import { fakeEnvironment } from './fake_opfs.js';

// A tab: its own database, current-group storage and DatabaseFile, on
// the file system shared by all tabs.
async function openTab(environment, localStorage = new FakeStorage()) {
  const tab = {
    db: new Database(),
    file: new DatabaseFile(localStorage, environment),
    localStorage,
  };
  tab.migrated = await tab.file.load(tab.db);
  return tab;
}

function addPerson(tab, id) {
  tab.db.addWithAttributes(id, { id: 'profile-' + id, name: id });
}

async function storedFile(environment) {
  const handle = await (
    await environment.directory()
  ).getFileHandle('GeniDatabase');
  return JSON.parse(await (await handle.getFile()).text());
}

test('a missing file loads as empty and the first save is version 1', async () => {
  const environment = fakeEnvironment();
  const tab = await openTab(environment);
  expect(tab.migrated).toBe(false);
  addPerson(tab, 'a');
  const result = await tab.file.save(tab.db);
  expect(result).toStrictEqual({
    version: 1,
    merged: false,
    conflicts: [],
    added: 0,
  });
  const file = await storedFile(environment);
  expect(Object.keys(file)[0]).toBe('version');
  expect(Object.keys(file.persons)).toStrictEqual(['a']);
});

test('saving again without other tabs does not merge', async () => {
  const environment = fakeEnvironment();
  const tab = await openTab(environment);
  await tab.file.save(tab.db);
  const result = await tab.file.save(tab.db);
  expect(result).toStrictEqual({
    version: 2,
    merged: false,
    conflicts: [],
    added: 0,
  });
});

test('two tabs saving in turn keep both tabs persons and groups', async () => {
  const environment = fakeEnvironment();
  const tab1 = await openTab(environment);
  const tab2 = await openTab(environment);
  addPerson(tab1, 'one');
  tab1.file.groupStore.save('g1', ['one']);
  addPerson(tab2, 'two');
  tab2.file.groupStore.save('g2', ['two']);
  expect((await tab1.file.save(tab1.db)).merged).toBe(false);
  const result = await tab2.file.save(tab2.db);
  expect(result.merged).toBe(true);
  expect(result.added).toBe(1);
  expect(result.version).toBe(2);
  expect(tab2.db.size()).toBe(2);
  const file = await storedFile(environment);
  expect(Object.keys(file.persons).sort()).toStrictEqual(['one', 'two']);
  expect(Object.keys(file.groups)).toStrictEqual(['g1', 'g2']);
  // Tab 1 now sees the version is higher and picks up tab 2's changes.
  const result1 = await tab1.file.save(tab1.db);
  expect(result1.merged).toBe(true);
  expect(tab1.db.size()).toBe(2);
  expect(tab1.file.groupStore.has('g2')).toBe(true);
});

test('concurrent saves are serialized by the lock', async () => {
  const environment = fakeEnvironment();
  const tab1 = await openTab(environment);
  const tab2 = await openTab(environment);
  addPerson(tab1, 'one');
  addPerson(tab2, 'two');
  const results = await Promise.all([
    tab1.file.save(tab1.db),
    tab2.file.save(tab2.db),
  ]);
  expect(results.map((r) => r.version)).toStrictEqual([1, 2]);
  expect(
    Object.keys((await storedFile(environment)).persons).sort(),
  ).toStrictEqual(['one', 'two']);
});

test('members added in two tabs to one group are both kept', async () => {
  const environment = fakeEnvironment();
  const setup = await openTab(environment);
  setup.file.groupStore.save('g', ['a']);
  await setup.file.save(setup.db);
  const tab1 = await openTab(environment);
  const tab2 = await openTab(environment);
  tab1.file.groupStore.save('g', ['a', 'b']);
  tab2.file.groupStore.save('g', []);
  tab2.file.groupStore.save('g', ['a', 'c']);
  await tab1.file.save(tab1.db);
  await tab2.file.save(tab2.db);
  expect(tab2.file.groupStore.entries('g')).toStrictEqual(['a', 'b', 'c']);
});

test('conflicting notes of both tabs are kept', async () => {
  const environment = fakeEnvironment();
  const setup = await openTab(environment);
  setup.file.groupStore.saveNotes('g', 'start');
  await setup.file.save(setup.db);
  const tab1 = await openTab(environment);
  const tab2 = await openTab(environment);
  tab1.file.groupStore.saveNotes('g', 'from one');
  tab2.file.groupStore.saveNotes('g', 'from two');
  await tab1.file.save(tab1.db);
  const result = await tab2.file.save(tab2.db);
  expect(result.conflicts).toStrictEqual(['g']);
  expect(tab2.file.groupStore.notes('g')).toBe('from one\n---\nfrom two');
});

test('a file without a version loads as version 0 and is upgraded', async () => {
  const environment = fakeEnvironment();
  const handle = await (
    await environment.directory()
  ).getFileHandle('GeniDatabase', { create: true });
  handle.content = JSON.stringify({
    persons: { a: { id: 'a', attributes: { id: 'profile-a' } } },
  });
  const tab = await openTab(environment);
  expect(tab.db.size()).toBe(1);
  const result = await tab.file.save(tab.db);
  expect(result.version).toBe(1);
  expect(result.merged).toBe(false);
});

test('groups of older versions are moved from local storage into the file', async () => {
  const environment = fakeEnvironment();
  const localStorage = new FakeStorage();
  localStorage.setItem('profileSet-old', JSON.stringify(['a']));
  const tab = await openTab(environment, localStorage);
  expect(tab.migrated).toBe(true);
  expect(tab.file.groupStore.entries('old')).toStrictEqual(['a']);
  await tab.file.save(tab.db);
  expect((await storedFile(environment)).groups.old.members).toStrictEqual([
    'a',
  ]);
  // Once the file has groups, local storage is no longer read for them.
  localStorage.setItem('profileSet-stale', JSON.stringify(['z']));
  const reopened = await openTab(environment, localStorage);
  expect(reopened.migrated).toBe(false);
  expect(reopened.file.groupStore.has('stale')).toBe(false);
});

test('two tabs migrating the same groups end up with the union', async () => {
  const environment = fakeEnvironment();
  const makeStorage = (members) => {
    const storage = new FakeStorage();
    storage.setItem('profileSet-g', JSON.stringify(members));
    return storage;
  };
  const tab1 = await openTab(environment, makeStorage(['a', 'b']));
  const tab2 = await openTab(environment, makeStorage(['a', 'c']));
  await tab1.file.save(tab1.db);
  await tab2.file.save(tab2.db);
  expect(tab2.file.groupStore.entries('g').sort()).toStrictEqual([
    'a',
    'b',
    'c',
  ]);
});

test('an unreadable stored file is overwritten', async () => {
  const environment = fakeEnvironment();
  const tab = await openTab(environment);
  await tab.file.save(tab.db);
  const handle = await (
    await environment.directory()
  ).getFileHandle('GeniDatabase');
  handle.content = '{\n  "version": 5, garbage';
  const result = await tab.file.save(tab.db);
  expect(result.version).toBe(6);
  expect(result.merged).toBe(false);
  expect((await storedFile(environment)).version).toBe(6);
});

test('a new tab gets the current group of the tab that saved last', async () => {
  const environment = fakeEnvironment();
  const first = await openTab(environment);
  expect(first.file.storedCurrentGroup).toBeUndefined();
  first.file.groupStore.save('g', []);
  await first.file.save(first.db, 'g');
  const second = await openTab(environment);
  expect(second.file.storedCurrentGroup).toBe('g');
  await second.file.save(second.db, '');
  expect((await storedFile(environment)).currentGroup).toBe('');
  const third = await openTab(environment);
  expect(third.file.storedCurrentGroup).toBe('');
});

test('the current group of older versions is read from local storage', async () => {
  const environment = fakeEnvironment();
  const localStorage = new FakeStorage();
  localStorage.setItem('currentSet', 'old');
  const tab = await openTab(environment, localStorage);
  expect(tab.file.storedCurrentGroup).toBe('old');
  await tab.file.save(tab.db, 'new');
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem('currentSet')).toBe('old');
  const next = await openTab(environment, localStorage);
  expect(next.file.storedCurrentGroup).toBe('new');
});

test('loading waits while another tab holds the lock to save', async () => {
  const environment = fakeEnvironment();
  const first = await openTab(environment);
  addPerson(first, 'a');
  await first.file.save(first.db);
  let release;
  const saving = environment.locks.request(
    'acac-database',
    () => new Promise((resolve) => (release = resolve)),
  );
  const second = { db: new Database() };
  second.file = new DatabaseFile(new FakeStorage(), environment);
  const loading = second.file.load(second.db);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The other tab writes the file while it holds the lock.
  addPerson(first, 'b');
  const handle = await (
    await environment.directory()
  ).getFileHandle('GeniDatabase');
  handle.content = JSON.stringify({
    version: 2,
    ...first.db.toJsonObject(),
    groups: {},
  });
  release();
  await saving;
  await loading;
  expect(second.db.get('b')).toBeDefined();
});

test('a save that cannot read the stored file fails and keeps it', async () => {
  const environment = fakeEnvironment();
  const first = await openTab(environment);
  const second = await openTab(environment);
  addPerson(first, 'a');
  await first.file.save(first.db);
  const handle = await (
    await environment.directory()
  ).getFileHandle('GeniDatabase');
  const content = handle.content;
  handle.failReads = true;
  await expect(second.file.save(second.db)).rejects.toThrow(
    'could not be read',
  );
  expect(handle.content).toBe(content);
});

test('replace writes over a file that cannot be read, moving it aside', async () => {
  const environment = fakeEnvironment();
  const old = await openTab(environment);
  addPerson(old, 'old');
  for (let i = 0; i < 5; i++) {
    await old.file.save(old.db);
  }
  const directory = await environment.directory();
  const handle = await directory.getFileHandle('GeniDatabase');
  const oldContent = handle.content;
  handle.failReads = true;

  // A tab that could not load the file restores a backup.
  const tab = { db: new Database() };
  tab.file = new DatabaseFile(new FakeStorage(), environment);
  await expect(tab.file.load(tab.db)).rejects.toThrow('could not be read');
  addPerson(tab, 'restored');
  tab.file.groupStore.save('g', ['restored']);
  const version = await tab.file.replace(tab.db, 'g');

  expect(version).toBe(6);
  expect(directory.names()).toStrictEqual(['GeniDatabase', 'GeniDatabase.old']);
  expect((await directory.getFileHandle('GeniDatabase.old')).content).toBe(
    oldContent,
  );
  const file = await storedFile(environment);
  expect(file.version).toBe(6);
  expect(Object.keys(file.persons)).toStrictEqual(['restored']);
  expect(file.groups.g.members).toStrictEqual(['restored']);
  expect(file.currentGroup).toBe('g');

  // The tab can save normally afterwards, without merging.
  const result = await tab.file.save(tab.db, 'g');
  expect(result.version).toBe(7);
  expect(result.merged).toBe(false);
});

test('replace deletes the old file if it cannot be moved', async () => {
  const environment = fakeEnvironment();
  const tab = await openTab(environment);
  addPerson(tab, 'a');
  await tab.file.save(tab.db);
  const directory = await environment.directory();
  directory.canMove = false;
  await tab.file.replace(new Database(), '');
  expect(directory.names()).toStrictEqual(['GeniDatabase']);
  expect(Object.keys((await storedFile(environment)).persons)).toStrictEqual(
    [],
  );
});

test('another tab merges a replaced file rather than saving over it', async () => {
  const environment = fakeEnvironment();
  const first = await openTab(environment);
  addPerson(first, 'a');
  await first.file.save(first.db);
  const second = await openTab(environment);
  const backup = new Database();
  backup.addWithAttributes('b', { id: 'profile-b', name: 'b' });
  await second.file.replace(backup, '');
  const result = await first.file.save(first.db);
  expect(result.merged).toBe(true);
  expect(
    Object.keys((await storedFile(environment)).persons).sort(),
  ).toStrictEqual(['a', 'b']);
});
