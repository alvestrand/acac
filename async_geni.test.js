import { jest } from '@jest/globals';
import { GeniClient } from './async_geni.js';

// A fake Geni SDK. Each test sets apiHandler to control how Geni.api responds.
let apiHandler;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  apiHandler = (operation, args, callback) => callback({});
  globalThis.Geni = {
    init: jest.fn(),
    connect: jest.fn(),
    api: jest.fn((operation, args, callback) =>
      apiHandler(operation, args, callback)),
  };
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete globalThis.Geni;
});

test('Constructor initializes Geni with the app id', () => {
  new GeniClient('my-app');
  expect(Geni.init).toHaveBeenCalledWith(
    expect.objectContaining({ app_id: 'my-app' }));
});

test('connect resolves when authorized, and only connects once', async () => {
  Geni.connect.mockImplementation(cb => cb({ status: 'authorized' }));
  const client = new GeniClient('app');
  await client.connect();
  expect(client.connected).toBe(true);
  await client.connect();
  expect(Geni.connect).toHaveBeenCalledTimes(1);
});

test('connect rejects when not authorized', async () => {
  Geni.connect.mockImplementation(cb => cb({ status: 'unauthorized' }));
  const client = new GeniClient('app');
  await expect(client.connect()).rejects.toMatch('unauthorized');
  expect(client.connected).toBe(false);
});

test('getPerson requests the profile by guid and resolves with the data', async () => {
  apiHandler = (operation, args, callback) => callback({ id: 'profile-1' });
  const client = new GeniClient('app');
  const result = await client.getPerson('1234');
  expect(Geni.api).toHaveBeenCalledWith(
    '/profile-g1234', [], expect.any(Function));
  expect(result).toEqual({ id: 'profile-1' });
});

test('getPersonByUrl strips the API prefix from the url', async () => {
  const client = new GeniClient('app');
  await client.getPersonByUrl('https://www.geni.com/api/profile-42');
  expect(Geni.api).toHaveBeenCalledWith(
    'profile-42', [], expect.any(Function));
});

test('getUnions passes the union ids as arguments', async () => {
  const client = new GeniClient('app');
  await client.getUnions(['union-1', 'union-2']);
  expect(Geni.api).toHaveBeenCalledWith(
    '/union', { ids: ['union-1', 'union-2'] }, expect.any(Function));
});

test('A Geni error rejects the promise', async () => {
  const error = { type: 'SomeException', message: 'Bad things' };
  apiHandler = (operation, args, callback) => callback({ error });
  const client = new GeniClient('app');
  await expect(client.getPerson('1')).rejects.toEqual(error);
});

test('An exception thrown by Geni.api rejects the promise', async () => {
  apiHandler = () => { throw new Error('boom'); };
  const client = new GeniClient('app');
  await expect(client.getPerson('1')).rejects.toThrow('boom');
});

test('Rate-limited operations are retried with unmodified args', async () => {
  let calls = 0;
  const seenIds = [];
  apiHandler = (operation, args, callback) => {
    calls++;
    seenIds.push([...args.ids]);
    // Emulate Geni mutating the args it is given.
    args.ids.push('garbage');
    if (calls == 1) {
      callback({ error: { type: 'ApiException',
                          message: 'Rate limit exceeded.' } });
    } else {
      callback({ ok: true });
    }
  };
  const client = new GeniClient('app');
  const promise = client.getUnions(['union-1']);
  expect(Geni.api).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(5000);
  await expect(promise).resolves.toEqual({ ok: true });
  expect(Geni.api).toHaveBeenCalledTimes(2);
  expect(seenIds).toEqual([['union-1'], ['union-1']]);
});

test('Operations are executed one at a time, in order', async () => {
  // Hold on to callbacks so that we control when operations complete.
  const pending = [];
  apiHandler = (operation, args, callback) => pending.push(callback);
  const client = new GeniClient('app');
  const queueSizes = [];
  client.queueSizeView = size => queueSizes.push(size);

  const first = client.getPerson('1');
  const second = client.getPerson('2');
  expect(Geni.api).toHaveBeenCalledTimes(1);
  expect(Geni.api.mock.calls[0][0]).toBe('/profile-g1');

  // First operation is still active, so nothing new starts.
  jest.advanceTimersByTime(5000);
  expect(Geni.api).toHaveBeenCalledTimes(1);

  pending[0]({ id: 'first' });
  await expect(first).resolves.toEqual({ id: 'first' });

  jest.advanceTimersByTime(5000);
  expect(Geni.api).toHaveBeenCalledTimes(2);
  expect(Geni.api.mock.calls[1][0]).toBe('/profile-g2');

  pending[1]({ id: 'second' });
  await expect(second).resolves.toEqual({ id: 'second' });

  jest.advanceTimersByTime(5000);
  expect(queueSizes.at(-1)).toBe(0);
});

test('queueSizeView reports waiting while rate limited', async () => {
  let rateLimited = true;
  apiHandler = (operation, args, callback) => {
    if (rateLimited) {
      callback({ error: { type: 'ApiException',
                          message: 'Rate limit exceeded.' } });
    } else {
      callback({ ok: true });
    }
  };
  const client = new GeniClient('app');
  const views = [];
  client.queueSizeView = (size, waiting) => views.push([size, waiting]);

  const promise = client.getPerson('1');
  expect(views.at(-1)).toEqual([1, true]);
  jest.advanceTimersByTime(5000);
  expect(views.at(-1)).toEqual([1, true]);

  rateLimited = false;
  jest.advanceTimersByTime(5000);
  await expect(promise).resolves.toEqual({ ok: true });
  expect(views.at(-1)).toEqual([1, false]);
  jest.advanceTimersByTime(5000);
  expect(views.at(-1)).toEqual([0, false]);
});

test('queueSizeView does not report waiting for a normal queue', () => {
  apiHandler = () => {};
  const client = new GeniClient('app');
  const views = [];
  client.queueSizeView = (size, waiting) => views.push([size, waiting]);
  client.getPerson('1');
  client.getPerson('2');
  expect(views).toEqual([[1, false], [2, false]]);
});
