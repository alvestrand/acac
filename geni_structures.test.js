import { isolateId, pathLength } from './geni_structures.js';

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
