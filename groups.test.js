import { profileIds, GroupStore } from './groups.js';
import { FakeStorage } from './fake_storage.js';

function makeStore() {
  const storage = new FakeStorage();
  // Stored the way older versions did it, with whole person records.
  storage.setItem('profileSet-old',
                  JSON.stringify([{ id: 'g1', attributes: { name: 'One' } }]));
  storage.setItem('profileSet-new', JSON.stringify(['g2', 'g3']));
  storage.setItem('unrelated', 'keep me');
  return { storage, groupStore: new GroupStore(storage) };
}

test('profileIds accepts both ids and person records', () => {
  expect(profileIds(['a', { id: 'b', attributes: {} }]))
    .toStrictEqual(['a', 'b']);
});

test('groups returns only profile sets, as ids', () => {
  const { groupStore } = makeStore();
  expect(groupStore.groups()).toStrictEqual({
    old: ['g1'],
    new: ['g2', 'g3']
  });
});

test('entries returns stored entries, or empty list for unknown group', () => {
  const { groupStore } = makeStore();
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g3']);
  expect(groupStore.entries('old')[0].attributes.name).toBe('One');
  expect(groupStore.entries('missing')).toStrictEqual([]);
});

test('currentName is empty when nothing is stored', () => {
  const groupStore = new GroupStore(new FakeStorage());
  expect(groupStore.currentName()).toBe('');
  groupStore.setCurrentName('x');
  expect(groupStore.currentName()).toBe('x');
});

// Names for the group menu

test('names lists stored groups and the current group, sorted', () => {
  const { groupStore } = makeStore();
  expect(groupStore.names('middle')).toStrictEqual(['middle', 'new', 'old']);
});

test('names does not repeat a current group that is stored', () => {
  const { groupStore } = makeStore();
  expect(groupStore.names('new')).toStrictEqual(['new', 'old']);
});

test('names includes the unnamed group', () => {
  const { storage, groupStore } = makeStore();
  expect(groupStore.names('')).toStrictEqual(['', 'new', 'old']);
  storage.setItem('profileSet-', '[]');
  expect(groupStore.names('new')).toStrictEqual(['', 'new', 'old']);
});

// Creating groups

test('create stores an empty group and returns its trimmed name', () => {
  const { groupStore } = makeStore();
  expect(groupStore.create('  fresh  ')).toBe('fresh');
  expect(groupStore.has('fresh')).toBe(true);
  expect(groupStore.has('  fresh  ')).toBe(false);
  expect(groupStore.entries('fresh')).toStrictEqual([]);
});

test('create ignores blank names', () => {
  const { groupStore } = makeStore();
  expect(groupStore.create('')).toBeNull();
  expect(groupStore.create('   ')).toBeNull();
  expect(groupStore.has('')).toBe(false);
});

test('create keeps the members of an existing group', () => {
  const { groupStore } = makeStore();
  expect(groupStore.create('new')).toBe('new');
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g3']);
});

// Switching groups

test('switchTo saves unsaved members of the group being left', () => {
  const { groupStore } = makeStore();
  groupStore.switchTo('new', ['g2', 'g3', 'g4'], 'old');
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g3', 'g4']);
  expect(groupStore.currentName()).toBe('old');
});

test('switchTo saves a group that was never stored', () => {
  const { groupStore } = makeStore();
  groupStore.switchTo('unsaved', ['g5'], 'new');
  expect(groupStore.entries('unsaved')).toStrictEqual(['g5']);
  expect(groupStore.names('new')).toContain('unsaved');
});

test('switching away and back brings back the same members', () => {
  const { groupStore } = makeStore();
  groupStore.switchTo('new', ['g2', 'g4'], 'old');
  groupStore.switchTo('old', profileIds(groupStore.entries('old')), 'new');
  expect(groupStore.currentName()).toBe('new');
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g4']);
  expect(groupStore.entries('old')).toStrictEqual(['g1']);
});

test('switchTo leaves other storage entries alone', () => {
  const { storage, groupStore } = makeStore();
  groupStore.switchTo('new', [], 'old');
  expect(storage.getItem('unrelated')).toBe('keep me');
});
