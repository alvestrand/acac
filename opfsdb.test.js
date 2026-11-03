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
