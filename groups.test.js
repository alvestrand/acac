import {
  profileIds,
  GroupStore,
  MemoryStorage,
  mergeGroups,
  notesSeparator,
} from './groups.js';

function makeStore() {
  const storage = new MemoryStorage();
  // Stored the way older versions did it, with whole person records.
  storage.setItem(
    'profileSet-old',
    JSON.stringify([{ id: 'g1', attributes: { name: 'One' } }]),
  );
  storage.setItem('profileSet-new', JSON.stringify(['g2', 'g3']));
  storage.setItem('unrelated', 'keep me');
  return { storage, groupStore: new GroupStore(storage) };
}

test('profileIds accepts both ids and person records', () => {
  expect(profileIds(['a', { id: 'b', attributes: {} }])).toStrictEqual([
    'a',
    'b',
  ]);
});

test('groups returns only profile sets, as ids', () => {
  const { groupStore } = makeStore();
  expect(groupStore.groups()).toStrictEqual({
    old: ['g1'],
    new: ['g2', 'g3'],
  });
});

test('entries returns stored entries, or empty list for unknown group', () => {
  const { groupStore } = makeStore();
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g3']);
  expect(groupStore.entries('old')[0].attributes.name).toBe('One');
  expect(groupStore.entries('missing')).toStrictEqual([]);
});

test('older array group format is parsed with empty notes', () => {
  const storage = new MemoryStorage();
  storage.setItem('profileSet-legacy', JSON.stringify(['g1', 'g2']));
  const groupStore = new GroupStore(storage);

  expect(groupStore.entries('legacy')).toStrictEqual(['g1', 'g2']);
  expect(groupStore.notes('legacy')).toBe('');
});

test('notes are stored with the group and survive member updates', () => {
  const { storage, groupStore } = makeStore();
  groupStore.saveNotes('new', 'Check this branch');
  groupStore.save('new', ['g2', 'g4']);

  expect(groupStore.notes('new')).toBe('Check this branch');
  expect(JSON.parse(storage.getItem('profileSet-new'))).toStrictEqual({
    members: ['g2', 'g4'],
    notes: 'Check this branch',
  });
});

test('currentName is empty when nothing is stored', () => {
  const groupStore = new GroupStore(new MemoryStorage());
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

test('excluded members are saved per group, and empty by default', () => {
  const { storage, groupStore } = makeStore();
  expect(groupStore.excluded('new')).toStrictEqual([]);
  groupStore.saveExcluded('new', ['g3']);
  expect(groupStore.excluded('new')).toStrictEqual(['g3']);
  expect(groupStore.excluded('old')).toStrictEqual([]);
  // Not taken for a group of its own.
  expect(Object.keys(groupStore.groups()).sort()).toStrictEqual(['new', 'old']);
  groupStore.saveExcluded('new', []);
  expect(storage.getItem('excludedSet-new')).toBeNull();
});

test('switchTo saves the excluded members of the group being left', () => {
  const { groupStore } = makeStore();
  groupStore.switchTo('new', ['g2', 'g3'], 'old', ['g2']);
  expect(groupStore.excluded('new')).toStrictEqual(['g2']);
  groupStore.switchTo('new', ['g2', 'g3'], 'old');
  expect(groupStore.excluded('new')).toStrictEqual([]);
});

test('remove forgets the excluded members too', () => {
  const { groupStore } = makeStore();
  groupStore.saveExcluded('new', ['g2']);
  groupStore.remove('new');
  expect(groupStore.excluded('new')).toStrictEqual([]);
});

function group(members, notes = '', excluded = []) {
  return { members, notes, excluded };
}

test('toObject and replaceAll round trip', () => {
  const { groupStore } = makeStore();
  groupStore.saveNotes('new', 'hello');
  groupStore.saveExcluded('new', ['g3']);
  const copy = new GroupStore(new MemoryStorage());
  copy.replaceAll(groupStore.toObject());
  expect(copy.toObject()).toStrictEqual({
    old: group(['g1']),
    new: group(['g2', 'g3'], 'hello', ['g3']),
  });
  copy.replaceAll({ only: group(['x']) });
  expect(Object.keys(copy.toObject())).toStrictEqual(['only']);
});

test('current group name is kept in its own storage', () => {
  const groups = new MemoryStorage();
  const current = new MemoryStorage();
  const groupStore = new GroupStore(groups, current);
  groupStore.setCurrentName('x');
  expect(current.getItem('currentSet')).toBe('x');
  expect(groups.getItem('currentSet')).toBeNull();
  expect(groupStore.currentName()).toBe('x');
});

test('mergeGroups keeps additions of both tabs and removals of mine', () => {
  const base = { g: group(['a', 'b', 'c'], '', ['a']) };
  const mine = { g: group(['a', 'c', 'm'], '', []) };
  const theirs = { g: group(['a', 'b', 'c', 't'], '', ['a', 'c']) };
  const result = mergeGroups(base, mine, theirs);
  expect(result.groups.g.members).toStrictEqual(['a', 'c', 't', 'm']);
  expect(result.groups.g.excluded).toStrictEqual(['c']);
  expect(result.conflicts).toStrictEqual([]);
});

test('mergeGroups takes notes changed in only one tab', () => {
  const base = { g: group([], 'old') };
  expect(mergeGroups(base, { g: group([], 'mine') }, base).groups.g.notes).toBe(
    'mine',
  );
  expect(
    mergeGroups(base, base, { g: group([], 'theirs') }).groups.g.notes,
  ).toBe('theirs');
});

test('mergeGroups keeps both notes texts on a conflict', () => {
  const base = { g: group([], 'old') };
  const result = mergeGroups(
    base,
    { g: group([], 'mine') },
    { g: group([], 'theirs') },
  );
  expect(result.groups.g.notes).toBe('theirs' + notesSeparator + 'mine');
  expect(notesSeparator).toBe('\n---\n');
  expect(result.conflicts).toStrictEqual(['g']);
});

test('mergeGroups treats a group created in both tabs as a merge', () => {
  const result = mergeGroups(
    {},
    { g: group(['a'], 'mine') },
    { g: group(['b'], '') },
  );
  expect(result.groups.g).toStrictEqual(group(['b', 'a'], 'mine'));
  expect(result.conflicts).toStrictEqual([]);
});

test('mergeGroups keeps groups created in one tab', () => {
  const result = mergeGroups({}, { m: group(['a']) }, { t: group(['b']) });
  expect(Object.keys(result.groups)).toStrictEqual(['m', 't']);
});

test('mergeGroups deletes a group only if the other tab left it alone', () => {
  const base = { x: group(['a']), y: group(['a']) };
  const changed = { x: group(['a']), y: group(['a', 'b']) };
  // I deleted both; they changed y.
  expect(mergeGroups(base, {}, changed).groups).toStrictEqual({
    y: group(['a', 'b']),
  });
  // They deleted both; I changed y.
  expect(mergeGroups(base, changed, {}).groups).toStrictEqual({
    y: group(['a', 'b']),
  });
  // They deleted both and I changed nothing.
  expect(mergeGroups(base, base, {}).groups).toStrictEqual({});
});

test('mergeGroups maps ids merged on Geni and removes duplicates', () => {
  const base = { g: group(['old']) };
  const result = mergeGroups(
    base,
    { g: group(['old', 'x']) },
    { g: group(['new']) },
    (id) => (id === 'old' ? 'new' : id),
  );
  expect(result.groups.g.members).toStrictEqual(['new', 'x']);
});
