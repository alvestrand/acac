import { pathLength } from './path_to.js';

test('pathLength uses Geni step_count', () => {
  expect(pathLength({ step_count: 25,
                      relations: Array(40).fill({}) })).toBe(25);
});

test('pathLength falls back to relation entries minus both endpoints', () => {
  expect(pathLength({ relations: Array(26).fill({}) })).toBe(25);
});

test('pathLength returns undefined when no path length is available', () => {
  expect(pathLength({})).toBeUndefined();
});
