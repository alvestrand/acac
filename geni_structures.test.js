import { isolateId } from './geni_structures.js';

test('isolateId takes the last part of a URL, without the query', () => {
  expect(
    isolateId(
      'https://www.geni.com/people/Kari-Lode/6000000011168336039?through=1',
    ),
  ).toBe('6000000011168336039');
  expect(isolateId('6000000011168336039')).toBe('6000000011168336039');
  expect(isolateId('https://www.geni.com/api/profile-123')).toBe('profile-123');
});
