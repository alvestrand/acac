import {
  profileIds,
  readStoredGroups,
  GroupStore,
  mergeGroups,
  notesSeparator,
} from './groups.js';
import { FakeStorage } from './fake_storage.js';

function makeStore() {
  const groupStore = new GroupStore();
  groupStore.save('old', ['g1']);
  groupStore.save('new', ['g2', 'g3']);
  return groupStore;
}

test('profileIds accepts both ids and person records', () => {
  expect(profileIds(['a', { id: 'b', attributes: {} }])).toStrictEqual([
    'a',
    'b',
  ]);
});

test('readStoredGroups reads all the formats of older versions', () => {
  const storage = new FakeStorage();
  // Whole person records, then plain ids, then members with notes.
  storage.setItem(
    'profileSet-records',
    JSON.stringify([{ id: 'g1', attributes: { name: 'One' } }]),
  );
  storage.setItem('profileSet-ids', JSON.stringify(['g2', 'g3']));
  storage.setItem(
    'profileSet-notes',
    JSON.stringify({ members: ['g4'], notes: 'Check this' }),
  );
  storage.setItem('excludedSet-notes', JSON.stringify(['g4']));
  storage.setItem('currentSet', 'ids');
  storage.setItem('unrelated', 'keep me');
  expect(readStoredGroups(storage)).toStrictEqual({
    records: { members: ['g1'], notes: '', excluded: [] },
    ids: { members: ['g2', 'g3'], notes: '', excluded: [] },
    notes: { members: ['g4'], notes: 'Check this', excluded: ['g4'] },
  });
  expect(storage.getItem('profileSet-ids')).not.toBeNull();
});

test('groups returns all groups, as ids', () => {
  expect(makeStore().groups()).toStrictEqual({
    old: ['g1'],
    new: ['g2', 'g3'],
  });
});

test('entries returns members, or empty list for unknown group', () => {
  const groupStore = makeStore();
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g3']);
  expect(groupStore.entries('missing')).toStrictEqual([]);
  expect(groupStore.has('missing')).toBe(false);
});

test('notes are stored with the group and survive member updates', () => {
  const groupStore = makeStore();
  expect(groupStore.notes('new')).toBe('');
  groupStore.saveNotes('new', 'Check this branch');
  groupStore.save('new', ['g2', 'g4']);

  expect(groupStore.notes('new')).toBe('Check this branch');
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g4']);
});

test('the store keeps its own copy of saved lists', () => {
  const groupStore = makeStore();
  const ids = ['g5'];
  groupStore.save('new', ids);
  ids.push('g6');
  groupStore.entries('new').push('g7');
  expect(groupStore.entries('new')).toStrictEqual(['g5']);
});

// Names for the group menu

test('names lists stored groups and the current group, sorted', () => {
  expect(makeStore().names('middle')).toStrictEqual(['middle', 'new', 'old']);
});

test('names does not repeat a current group that is stored', () => {
  expect(makeStore().names('new')).toStrictEqual(['new', 'old']);
});

test('names includes the unnamed group', () => {
  const groupStore = makeStore();
  expect(groupStore.names('')).toStrictEqual(['', 'new', 'old']);
  groupStore.save('', []);
  expect(groupStore.names('new')).toStrictEqual(['', 'new', 'old']);
});

// Creating groups

test('create stores an empty group and returns its trimmed name', () => {
  const groupStore = makeStore();
  expect(groupStore.create('  fresh  ')).toBe('fresh');
  expect(groupStore.has('fresh')).toBe(true);
  expect(groupStore.has('  fresh  ')).toBe(false);
  expect(groupStore.entries('fresh')).toStrictEqual([]);
});

test('create ignores blank names', () => {
  const groupStore = makeStore();
  expect(groupStore.create('')).toBeNull();
  expect(groupStore.create('   ')).toBeNull();
  expect(groupStore.has('')).toBe(false);
});

test('create keeps the members of an existing group', () => {
  const groupStore = makeStore();
  expect(groupStore.create('new')).toBe('new');
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g3']);
});

// Leaving groups

test('saveMembers saves members and excluded members of a group', () => {
  const groupStore = makeStore();
  groupStore.saveMembers('new', ['g2', 'g3', 'g4'], ['g2']);
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g3', 'g4']);
  expect(groupStore.excluded('new')).toStrictEqual(['g2']);
  groupStore.saveMembers('new', ['g2', 'g3']);
  expect(groupStore.excluded('new')).toStrictEqual([]);
});

test('saveMembers saves a group that was never stored', () => {
  const groupStore = makeStore();
  groupStore.saveMembers('unsaved', ['g5']);
  expect(groupStore.entries('unsaved')).toStrictEqual(['g5']);
  expect(groupStore.has('unsaved')).toBe(true);
});

test('saveMembers leaves other groups and notes alone', () => {
  const groupStore = makeStore();
  groupStore.saveNotes('new', 'keep');
  groupStore.saveMembers('new', []);
  expect(groupStore.notes('new')).toBe('keep');
  expect(groupStore.entries('old')).toStrictEqual(['g1']);
});

test('excluded members are saved per group, and empty by default', () => {
  const groupStore = makeStore();
  expect(groupStore.excluded('new')).toStrictEqual([]);
  groupStore.saveExcluded('new', ['g3']);
  expect(groupStore.excluded('new')).toStrictEqual(['g3']);
  expect(groupStore.excluded('old')).toStrictEqual([]);
  expect(Object.keys(groupStore.groups()).sort()).toStrictEqual(['new', 'old']);
});

test('remove forgets the group and its excluded members', () => {
  const groupStore = makeStore();
  groupStore.saveExcluded('new', ['g2']);
  groupStore.remove('new');
  expect(groupStore.has('new')).toBe(false);
  expect(groupStore.excluded('new')).toStrictEqual([]);
});

// Renaming groups

test('rename keeps members, notes and excluded members', () => {
  const groupStore = makeStore();
  groupStore.saveNotes('new', 'hello');
  groupStore.saveExcluded('new', ['g3']);
  expect(groupStore.rename('new', 'newer')).toBe('newer');
  expect(groupStore.has('new')).toBe(false);
  expect(groupStore.entries('newer')).toStrictEqual(['g2', 'g3']);
  expect(groupStore.notes('newer')).toBe('hello');
  expect(groupStore.excluded('newer')).toStrictEqual(['g3']);
});

test('rename trims the new name', () => {
  const groupStore = makeStore();
  expect(groupStore.rename('new', '  newer  ')).toBe('newer');
  expect(groupStore.has('newer')).toBe(true);
});

test('rename refuses blank and used names, and unknown groups', () => {
  const groupStore = makeStore();
  expect(groupStore.rename('new', '   ')).toBeNull();
  expect(groupStore.rename('new', 'old')).toBeNull();
  expect(groupStore.rename('missing', 'other')).toBeNull();
  expect(groupStore.groups()).toStrictEqual({
    old: ['g1'],
    new: ['g2', 'g3'],
  });
});

function group(members, notes = '', excluded = []) {
  return { members, notes, excluded };
}

test('toObject and replaceAll round trip', () => {
  const groupStore = makeStore();
  groupStore.saveNotes('new', 'hello');
  groupStore.saveExcluded('new', ['g3']);
  const copy = new GroupStore();
  copy.replaceAll(groupStore.toObject());
  expect(copy.toObject()).toStrictEqual({
    old: group(['g1']),
    new: group(['g2', 'g3'], 'hello', ['g3']),
  });
  copy.replaceAll({ only: group(['x']) });
  expect(Object.keys(copy.toObject())).toStrictEqual(['only']);
});

test('toObject and replaceAll copy the data', () => {
  const groupStore = makeStore();
  const object = groupStore.toObject();
  object.new.members.push('changed');
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g3']);
  groupStore.replaceAll(object);
  object.new.members.push('again');
  expect(groupStore.entries('new')).toStrictEqual(['g2', 'g3', 'changed']);
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

test('mergeGroups leaves out a group deleted in both tabs', () => {
  const base = { x: group(['a']), y: group(['b']) };
  const kept = { y: group(['b']) };
  expect(mergeGroups(base, kept, kept).groups).toStrictEqual({
    y: group(['b']),
  });
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
