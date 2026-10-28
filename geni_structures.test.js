import { isolateId, pathLength, resolveParents } from './geni_structures.js';

test('pathLength uses Geni step_count', () => {
  expect(pathLength({ step_count: 25, relations: Array(40).fill({}) })).toBe(
    25,
  );
});

test('pathLength falls back to relation entries minus both endpoints', () => {
  expect(pathLength({ relations: Array(26).fill({}) })).toBe(25);
});

test('pathLength returns undefined when no path length is available', () => {
  expect(pathLength({})).toBeUndefined();
});
test('isolateId takes the last part of a URL, without the query', () => {
  expect(
    isolateId(
      'https://www.geni.com/people/Kari-Lode/6000000011168336039?through=1',
    ),
  ).toBe('6000000011168336039');
  expect(isolateId('6000000011168336039')).toBe('6000000011168336039');
  expect(isolateId('https://www.geni.com/api/profile-123')).toBe('profile-123');
});

test('resolveParents returns partners for biological children', () => {
  const profile = {
    attribute: (key) => (key === 'id' ? 'profile-1' : undefined),
  };
  const unions = [
    {
      children: ['https://www.geni.com/api/profile-1'],
      partners: [
        'https://www.geni.com/api/profile-10',
        'https://www.geni.com/api/profile-11',
      ],
    },
  ];
  expect(resolveParents(profile, unions)).toStrictEqual([
    'https://www.geni.com/api/profile-10',
    'https://www.geni.com/api/profile-11',
  ]);
});

test('resolveParents ignores adopted and foster children', () => {
  const profile = {
    attribute: (key) => (key === 'id' ? 'profile-1' : undefined),
  };
  const adoptedUnion = [
    {
      children: ['https://www.geni.com/api/profile-1'],
      adopted_children: ['https://www.geni.com/api/profile-1'],
      partners: ['https://www.geni.com/api/profile-10'],
    },
  ];
  const fosterUnion = [
    {
      children: ['https://www.geni.com/api/profile-1'],
      foster_children: ['https://www.geni.com/api/profile-1'],
      partners: ['https://www.geni.com/api/profile-10'],
    },
  ];
  expect(resolveParents(profile, adoptedUnion)).toStrictEqual([]);
  expect(resolveParents(profile, fosterUnion)).toStrictEqual([]);
});
