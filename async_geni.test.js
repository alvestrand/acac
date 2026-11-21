import { jest } from '@jest/globals';
import { GeniClient } from './async_geni.js';
import { profileFields } from './geni_structures.js';
import { FakeStorage } from './fake_storage.js';

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
      apiHandler(operation, args, callback),
    ),
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
    expect.objectContaining({ app_id: 'my-app' }),
  );
});

test('connect resolves when authorized, and only connects once', async () => {
  Geni.connect.mockImplementation((cb) => cb({ status: 'authorized' }));
  const client = new GeniClient('app');
  await client.connect();
  expect(client.connected).toBe(true);
  await client.connect();
  expect(Geni.connect).toHaveBeenCalledTimes(1);
});

test('connect rejects when not authorized', async () => {
  Geni.connect.mockImplementation((cb) => cb({ status: 'unauthorized' }));
  const client = new GeniClient('app');
  await expect(client.connect()).rejects.toMatch('unauthorized');
  expect(client.connected).toBe(false);
});

test('connect rejects cleanly when response is undefined', async () => {
  Geni.connect.mockImplementation((cb) => cb(undefined));
  const client = new GeniClient('app');
  await expect(client.connect()).rejects.toMatch('undefined');
  expect(client.connected).toBe(false);
});

test('getPerson requests the used fields of the profile by guid and resolves with the data', async () => {
  apiHandler = (operation, args, callback) => callback({ id: 'profile-1' });
  const client = new GeniClient('app');
  const result = await client.getPerson('1234');
  expect(Geni.api).toHaveBeenCalledWith(
    '/profile-g1234',
    { fields: profileFields.join(',') },
    expect.any(Function),
  );
  expect(result).toEqual({ id: 'profile-1' });
});

test('getPersonByUrl strips the API prefix from the url', async () => {
  const client = new GeniClient('app');
  await client.getPersonByUrl('https://www.geni.com/api/profile-42');
  expect(Geni.api).toHaveBeenCalledWith(
    'profile-42',
    { fields: profileFields.join(',') },
    expect.any(Function),
  );
});

test('getPathTo requests the selected path type between profile ids', async () => {
  const answer = { status: 'done', relationship: 'first cousin' };
  apiHandler = (operation, args, callback) => callback(answer);
  const client = new GeniClient('app');
  const result = await client.getPathTo(
    'https://www.geni.com/api/profile-42',
    'profile-99',
    'inlaw',
  );
  expect(Geni.api).toHaveBeenCalledWith(
    '/profile-42/path-to/profile-99',
    { path_type: 'inlaw' },
    expect.any(Function),
  );
  expect(result).toEqual(answer);
});

test('getPathTo defaults to blood paths', async () => {
  const client = new GeniClient('app');
  await client.getPathTo('profile-42', 'profile-99');
  expect(Geni.api).toHaveBeenCalledWith(
    '/profile-42/path-to/profile-99',
    { path_type: 'blood' },
    expect.any(Function),
  );
});

test('getUnions passes the union ids as arguments', async () => {
  const client = new GeniClient('app');
  await client.getUnions(['union-1', 'union-2']);
  expect(Geni.api).toHaveBeenCalledWith(
    '/union',
    { ids: ['union-1', 'union-2'] },
    expect.any(Function),
  );
});

test('A Geni error rejects the promise', async () => {
  const error = { type: 'SomeException', message: 'Bad things' };
  apiHandler = (operation, args, callback) => callback({ error });
  const client = new GeniClient('app');
  await expect(client.getPerson('1')).rejects.toEqual(error);
});

test('A Geni callback error is reported to onCallbackError', async () => {
  apiHandler = (operation, args, callback) => callback(null);
  const client = new GeniClient('app');
  client.onCallbackError = jest.fn();

  await expect(client.getPerson('1')).rejects.toThrow();

  expect(client.onCallbackError).toHaveBeenCalledWith(
    expect.any(TypeError),
    '/profile-g1',
  );
});

test('An exception thrown by Geni.api rejects the promise', async () => {
  apiHandler = () => {
    throw new Error('boom');
  };
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
      callback({
        error: { type: 'ApiException', message: 'Rate limit exceeded.' },
      });
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
  client.queueSizeView = (size) => queueSizes.push(size);

  const first = client.getPerson('1');
  const second = client.getPerson('2');
  expect(Geni.api).toHaveBeenCalledTimes(1);
  expect(Geni.api.mock.calls[0][0]).toBe('/profile-g1');

  // First operation is still active, so nothing new starts (within the
  // time Geni has to answer).
  jest.advanceTimersByTime(4000);
  expect(Geni.api).toHaveBeenCalledTimes(1);

  // The second operation starts as soon as the first is finished.
  pending[0]({ id: 'first' });
  expect(Geni.api).toHaveBeenCalledTimes(2);
  expect(Geni.api.mock.calls[1][0]).toBe('/profile-g2');
  expect(queueSizes.at(-1)).toBe(1);
  await expect(first).resolves.toEqual({ id: 'first' });

  pending[1]({ id: 'second' });
  expect(queueSizes.at(-1)).toBe(0);
  await expect(second).resolves.toEqual({ id: 'second' });
});

test('Rate-limited operations are retried only after the delay', () => {
  let rateLimited = true;
  const pending = [];
  apiHandler = (operation, args, callback) => {
    if (rateLimited) {
      callback({
        error: { type: 'ApiException', message: 'Rate limit exceeded.' },
      });
    } else {
      pending.push(callback);
    }
  };
  const client = new GeniClient('app');
  client.getPerson('1');
  client.getPerson('2');
  expect(Geni.api).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(4999);
  expect(Geni.api).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  expect(Geni.api).toHaveBeenCalledTimes(2);
  expect(Geni.api.mock.calls[1][0]).toBe('/profile-g1');

  // Once the rate limit is over, there is no delay between operations.
  rateLimited = false;
  jest.advanceTimersByTime(5000);
  expect(Geni.api).toHaveBeenCalledTimes(3);
  pending[0]({ id: 'first' });
  expect(Geni.api).toHaveBeenCalledTimes(4);
  expect(Geni.api.mock.calls[3][0]).toBe('/profile-g2');
});

test('An operation that throws does not block the queue', async () => {
  let finishFirst;
  apiHandler = (operation, args, callback) => {
    if (operation === '/profile-g1') {
      finishFirst = callback;
    } else if (operation === '/profile-g2') {
      throw new Error('boom');
    } else {
      callback({ id: operation });
    }
  };
  const client = new GeniClient('app');
  const first = client.getPerson('1');
  const second = client.getPerson('2');
  const third = client.getPerson('3');
  expect(Geni.api).toHaveBeenCalledTimes(1);

  finishFirst({ id: 'first' });
  await expect(first).resolves.toEqual({ id: 'first' });
  await expect(second).rejects.toThrow('boom');
  await expect(third).resolves.toEqual({ id: '/profile-g3' });
});

test('queueSizeView reports waiting while rate limited', async () => {
  let rateLimited = true;
  apiHandler = (operation, args, callback) => {
    if (rateLimited) {
      callback({
        error: { type: 'ApiException', message: 'Rate limit exceeded.' },
      });
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
  expect(views.at(-1)).toEqual([0, false]);
});

test('queueSizeView does not report waiting for a normal queue', () => {
  apiHandler = () => {};
  const client = new GeniClient('app');
  const views = [];
  client.queueSizeView = (size, waiting) => views.push([size, waiting]);
  client.getPerson('1');
  client.getPerson('2');
  expect(views).toEqual([
    [1, false],
    [2, false],
  ]);
});

test('stop rejects queued operations and ignores the running one', async () => {
  const pending = [];
  apiHandler = (operation, args, callback) => pending.push(callback);
  const client = new GeniClient('app');
  const views = [];
  client.queueSizeView = (size, waiting) => views.push([size, waiting]);
  const first = client.getPerson('1');
  const second = client.getPerson('2');

  client.stop();
  expect(client.stopped).toBe(true);
  await expect(first).rejects.toThrow('Fetching stopped');
  await expect(second).rejects.toThrow('Fetching stopped');
  expect(views.at(-1)).toEqual([0, false]);

  // The answer to the running operation arrives later and is ignored.
  pending[0]({ id: 'late' });
  expect(Geni.api).toHaveBeenCalledTimes(1);
  expect(views.at(-1)).toEqual([0, false]);
});

test('stop rejects new operations until start', async () => {
  const client = new GeniClient('app');
  client.stop();
  await expect(client.getPerson('1')).rejects.toThrow('Fetching stopped');
  expect(Geni.api).not.toHaveBeenCalled();

  client.start();
  expect(client.stopped).toBe(false);
  await expect(client.getPerson('2')).resolves.toEqual({});
  expect(Geni.api).toHaveBeenCalledTimes(1);
});

test('stop cancels a pending rate limit retry', async () => {
  apiHandler = (operation, args, callback) =>
    callback({
      error: { type: 'ApiException', message: 'Rate limit exceeded.' },
    });
  const client = new GeniClient('app');
  const promise = client.getPerson('1');
  client.stop();
  await expect(promise).rejects.toThrow('Fetching stopped');
  jest.advanceTimersByTime(10000);
  expect(Geni.api).toHaveBeenCalledTimes(1);
});

// Keeping the login in the token storage

test('A stored login is given to Geni and makes the client connected', () => {
  const storage = new FakeStorage();
  storage.setItem('geniAccessToken', 'access');
  storage.setItem('geniRefreshToken', 'refresh');
  const client = new GeniClient('app', storage);
  expect(Geni.init).toHaveBeenCalledWith({
    app_id: 'app',
    logging: false,
    access_token: 'access',
    refresh_token: 'refresh',
  });
  expect(client.connected).toBe(true);
});

test('Without a stored login the client is not connected', () => {
  const client = new GeniClient('app', new FakeStorage());
  expect(Geni.init).toHaveBeenCalledWith({ app_id: 'app', logging: false });
  expect(client.connected).toBe(false);
});

test('connect stores the login', async () => {
  Geni.connect.mockImplementation((cb) => {
    Geni._access_token = 'access';
    Geni._refresh_token = 'refresh';
    cb({ status: 'authorized' });
  });
  const storage = new FakeStorage();
  const client = new GeniClient('app', storage);
  await client.connect();
  expect(storage.getItem('geniAccessToken')).toBe('access');
  expect(storage.getItem('geniRefreshToken')).toBe('refresh');
});

test('connect resolves without an answer when Geni already has a token', async () => {
  Geni._access_token = 'access';
  Geni.connect.mockImplementation((cb) => cb());
  const storage = new FakeStorage();
  const client = new GeniClient('app', storage);
  await client.connect();
  expect(client.connected).toBe(true);
  expect(storage.getItem('geniAccessToken')).toBe('access');
  expect(storage.getItem('geniRefreshToken')).toBeNull();
});

test('A token refreshed by the SDK is stored after the answer', async () => {
  const storage = new FakeStorage();
  storage.setItem('geniAccessToken', 'old');
  apiHandler = (operation, args, callback) => {
    Geni._access_token = 'new';
    callback({ id: 'profile-1' });
  };
  const client = new GeniClient('app', storage);
  await client.getPerson('1');
  expect(storage.getItem('geniAccessToken')).toBe('new');
});

test('A rejected login is forgotten and stops fetching', async () => {
  const storage = new FakeStorage();
  storage.setItem('geniAccessToken', 'expired');
  storage.setItem('geniRefreshToken', 'refresh');
  Geni._access_token = 'expired';
  Geni._refresh_token = 'refresh';
  const error = { type: 'OAuthException', message: 'Invalid access token' };
  const pending = [];
  apiHandler = (operation, args, callback) => pending.push(callback);
  const client = new GeniClient('app', storage);
  client.onLoggedOut = jest.fn();
  const first = client.getPerson('1');
  const second = client.getPerson('2');
  pending[0]({ error });

  await expect(first).rejects.toEqual(error);
  await expect(second).rejects.toThrow('Fetching stopped');
  expect(client.connected).toBe(false);
  expect(client.stopped).toBe(true);
  expect(client.onLoggedOut).toHaveBeenCalledTimes(1);
  expect(storage.length).toBe(0);
  expect(Geni._access_token).toBeNull();
  expect(Geni._refresh_token).toBeNull();
  expect(Geni.api).toHaveBeenCalledTimes(1);
});

// Operations Geni does not answer

test('An operation Geni does not answer in time forgets the login', async () => {
  const storage = new FakeStorage();
  storage.setItem('geniAccessToken', 'expired');
  storage.setItem('geniRefreshToken', 'refresh');
  Geni._access_token = 'expired';
  Geni._refresh_token = 'refresh';
  const pending = [];
  apiHandler = (operation, args, callback) => pending.push(callback);
  const client = new GeniClient('app', storage);
  client.onTimeout = jest.fn();
  client.onLoggedOut = jest.fn();
  const first = client.getPerson('1');
  const second = client.getPerson('2');

  jest.advanceTimersByTime(4999);
  expect(client.onTimeout).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  await expect(first).rejects.toThrow('Geni did not answer within 5 seconds');
  await expect(second).rejects.toThrow('Fetching stopped');
  expect(client.onTimeout).toHaveBeenCalledWith('/profile-g1');
  expect(client.onLoggedOut).not.toHaveBeenCalled();
  expect(client.connected).toBe(false);
  expect(client.stopped).toBe(true);
  expect(storage.length).toBe(0);
  expect(Geni._access_token).toBeNull();
  expect(Geni._refresh_token).toBeNull();

  // A late answer is ignored.
  pending[0]({ id: 'late' });
  expect(Geni.api).toHaveBeenCalledTimes(1);
});

test('After a timeout, connect asks for a new login', async () => {
  Geni._access_token = 'expired';
  Geni.connect.mockImplementation((cb) => {
    if (Geni._access_token) {
      cb();
    } else {
      Geni._access_token = 'fresh';
      cb({ status: 'authorized' });
    }
  });
  apiHandler = () => {};
  const storage = new FakeStorage();
  storage.setItem('geniAccessToken', 'expired');
  const client = new GeniClient('app', storage);
  const operation = client.getPerson('1');
  jest.advanceTimersByTime(5000);
  await expect(operation).rejects.toThrow('did not answer');

  await client.connect();
  expect(client.connected).toBe(true);
  expect(storage.getItem('geniAccessToken')).toBe('fresh');
});

test('An answer in time cancels the timeout', async () => {
  const pending = [];
  apiHandler = (operation, args, callback) => pending.push(callback);
  const client = new GeniClient('app');
  client.onTimeout = jest.fn();
  const operation = client.getPerson('1');
  jest.advanceTimersByTime(4000);
  pending[0]({ id: 'profile-1' });
  await expect(operation).resolves.toEqual({ id: 'profile-1' });
  jest.advanceTimersByTime(10000);
  expect(client.onTimeout).not.toHaveBeenCalled();
  expect(client.connected).toBe(false);
  expect(client.stopped).toBe(false);
});

test('A stopped operation does not time out', async () => {
  apiHandler = () => {};
  const client = new GeniClient('app');
  client.onTimeout = jest.fn();
  const operation = client.getPerson('1');
  client.stop();
  await expect(operation).rejects.toThrow('Fetching stopped');
  jest.advanceTimersByTime(10000);
  expect(client.onTimeout).not.toHaveBeenCalled();
});

test('logout stops fetching and forgets the login', async () => {
  const storage = new FakeStorage();
  storage.setItem('geniAccessToken', 'access');
  storage.setItem('geniRefreshToken', 'refresh');
  Geni._access_token = 'access';
  Geni._refresh_token = 'refresh';
  apiHandler = () => {};
  const client = new GeniClient('app', storage);
  client.onLoggedOut = jest.fn();
  client.onTimeout = jest.fn();
  const operation = client.getPerson('1');

  client.logout();
  await expect(operation).rejects.toThrow('Fetching stopped');
  expect(client.connected).toBe(false);
  expect(client.stopped).toBe(true);
  expect(storage.length).toBe(0);
  expect(Geni._access_token).toBeNull();
  expect(Geni._refresh_token).toBeNull();
  jest.advanceTimersByTime(10000);
  expect(client.onTimeout).not.toHaveBeenCalled();
  expect(client.onLoggedOut).not.toHaveBeenCalled();
});
