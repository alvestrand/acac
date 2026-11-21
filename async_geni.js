// This module offers an interface to Geni that will use Fetch to get persons and ancestors of persons.
// It maintains a queue of operations, and will execute them as fast as the Geni rate limit permits.
// It assumes that the Geni API is available in the global environment (todo: inject it)

export { GeniClient };
import { urlToId, profileFields } from './geni_structures.js';

// Parameters for profile requests: only the fields the app uses.
const profileParams = { fields: profileFields.join(',') };

// How long to wait before retrying when Geni says the rate limit
// is exceeded, in milliseconds.
const rateLimitRetryDelay = 5000;

// How long to wait for Geni's answer to an operation, in milliseconds.
// Geni seems not to answer at all when the access token has expired, so
// an operation without an answer is taken to mean that the login is
// gone.
const answerTimeout = 5000;

// The keys under which the Geni login is kept in the token storage
// given to GeniClient (normally sessionStorage), so that it survives
// reloading the page.
const accessTokenKey = 'geniAccessToken';
const refreshTokenKey = 'geniRefreshToken';

class GeniOperation {
  constructor(operation, args, resolve, reject, onCallbackError) {
    this.operation = operation;
    this.args = args;
    this.resolve = resolve;
    this.reject = reject;
    this.onCallbackError = onCallbackError;
    // Set when the client stops fetching or the operation times out.
    // Geni's answer is then ignored.
    this.cancelled = false;
  }

  // Run the operation. Calls done with 'rateLimited' when Geni says the
  // rate limit is exceeded, in which case the operation should be run
  // again later. Otherwise the operation is resolved or rejected, and
  // done is called with 'unauthorized' if Geni did not accept the access
  // token, 'answered' if Geni answered otherwise, 'timedOut' if Geni did
  // not answer within answerTimeout, or 'failed' if the call to Geni
  // threw.
  execute(done) {
    const timer = setTimeout(() => {
      if (this.cancelled) {
        return;
      }
      this.cancelled = true;
      console.log('Geni did not answer:', this.operation);
      this.reject(
        new Error(`Geni did not answer within ${answerTimeout / 1000} seconds`),
      );
      done('timedOut');
    }, answerTimeout);
    try {
      // Geni modifies the args argument, so clone it.
      const args = structuredClone(this.args);
      Geni.api(this.operation, args, (data) => {
        if (this.cancelled) {
          return;
        }
        clearTimeout(timer);
        try {
          if (data.error) {
            console.log('Geni operation failed:', this.operation, data.error);
            if (
              data.error.type == 'ApiException' &&
              data.error.message == 'Rate limit exceeded.'
            ) {
              done('rateLimited');
              return;
            }
            this.reject(data.error);
            if (data.error.type == 'OAuthException') {
              done('unauthorized');
              return;
            }
          } else {
            this.resolve(data);
          }
          done('answered');
        } catch (error) {
          console.log('Geni callback failed:', this.operation, error);
          try {
            this.onCallbackError(error, this.operation);
          } catch (reportError) {
            console.log('Reporting Geni callback failure threw:', reportError);
          }
          this.reject(error);
          done('failed');
        }
      });
    } catch (error) {
      clearTimeout(timer);
      console.log('Geni operation threw an error:', this.operation, error);
      this.reject(error);
      done('failed');
    }
  }
}

class GeniClient {
  // Operations waiting to run. The first one is running, or waiting
  // to be retried because of the rate limit.
  #operationQueue;
  // True from when Geni says the rate limit is exceeded until
  // an operation gets another answer.
  #rateLimited = false;
  // Timer for retrying an operation after the rate limit was exceeded.
  #retryTimer;
  // True after stop(), until start().
  #stopped = false;
  // Where the login is kept between page loads, or undefined.
  #tokenStorage;

  // tokenStorage, if given, is a Storage object (normally sessionStorage)
  // that keeps the Geni login, so that a reloaded page is still logged
  // in. The client starts as connected if it holds a login.
  constructor(appId, tokenStorage = undefined) {
    this.#tokenStorage = tokenStorage;
    const accessToken = tokenStorage?.getItem(accessTokenKey);
    const refreshToken = tokenStorage?.getItem(refreshTokenKey);
    this.connected = Boolean(accessToken);
    this.#operationQueue = [];
    // Called with the number of queued operations, and whether the
    // connection is waiting for the Geni rate limit.
    this.queueSizeView = (number, waiting) => {};
    // Called when processing Geni's response callback throws.
    this.onCallbackError = () => {};
    // Called when Geni no longer accepts the login. The client is then
    // not connected, and fetching is stopped.
    this.onLoggedOut = () => {};
    // Called with the operation (its API path) when Geni did not answer
    // it in time. The login is then forgotten, the client is not
    // connected, and fetching is stopped.
    this.onTimeout = () => {};
    Geni.init({
      app_id: appId,
      logging: false,
      ...(accessToken ? { access_token: accessToken } : {}),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    });
  }

  // Keep the SDK's current login in the token storage. The SDK replaces
  // the access token when it refreshes it with the refresh token.
  #rememberLogin() {
    const storage = this.#tokenStorage;
    if (!storage) {
      return;
    }
    for (const [key, value] of [
      [accessTokenKey, Geni._access_token],
      [refreshTokenKey, Geni._refresh_token],
    ]) {
      if (value) {
        if (storage.getItem(key) !== value) {
          storage.setItem(key, value);
        }
      } else {
        storage.removeItem(key);
      }
    }
  }

  // Geni did not accept the access token, and the SDK could not refresh
  // it: forget the login and stop fetching.
  #loggedOut() {
    console.log('Geni no longer accepts the login');
    this.#forgetLogin();
    this.stop();
    this.onLoggedOut();
  }

  // Geni did not answer operation in time, probably because the access
  // token has expired: forget the login, so that the next connect asks
  // for a new one, and stop fetching.
  #timedOut(operation) {
    this.#forgetLogin();
    this.stop();
    this.onTimeout(operation);
  }

  // Log out of ACAC on the user's request: stop fetching and forget the
  // login, so that the next connect asks for a new one. The user stays
  // logged in to geni.com itself.
  logout() {
    console.log('Logging out of Geni');
    this.stop();
    this.#forgetLogin();
  }

  // Forget the login, in the SDK and in the token storage, so that the
  // client is not connected and the next connect asks for a new login.
  #forgetLogin() {
    this.connected = false;
    // The SDK only clears its access token itself the first time it
    // tries to refresh it, so clear it here, or connect would not ask
    // for a new login.
    Geni._access_token = null;
    Geni._refresh_token = null;
    this.#tokenStorage?.removeItem(accessTokenKey);
    this.#tokenStorage?.removeItem(refreshTokenKey);
  }

  // Add an operation to the queue, starting it at once if nothing
  // else is running.
  #enqueue(op) {
    if (this.#stopped) {
      op.reject(new Error('Fetching stopped'));
      return;
    }
    this.#operationQueue.push(op);
    if (this.#operationQueue.length === 1) {
      this.#execute(op);
    }
    this.#showQueueSize();
  }

  // Run an operation. When it is finished, start the next one at once.
  // When rate limited, run it again after a delay.
  #execute(op) {
    op.execute((outcome) => {
      if (outcome === 'unauthorized') {
        this.#operationQueue.shift();
        this.#loggedOut();
        return;
      }
      if (outcome === 'timedOut') {
        this.#operationQueue.shift();
        this.#timedOut(op.operation);
        return;
      }
      if (outcome === 'rateLimited') {
        this.#rateLimited = true;
        this.#retryTimer = setTimeout(() => {
          this.#retryTimer = undefined;
          this.#execute(op);
        }, rateLimitRetryDelay);
      } else {
        if (outcome === 'answered') {
          this.#rateLimited = false;
          this.#rememberLogin();
        }
        this.#operationQueue.shift();
        if (this.#operationQueue.length > 0) {
          this.#execute(this.#operationQueue[0]);
        }
      }
      this.#showQueueSize();
    });
  }

  // Stop fetching: reject all queued operations, ignore the answer to
  // the one that is running, and reject new operations until start()
  // is called. Rejected operations get an Error 'Fetching stopped'.
  stop() {
    this.#stopped = true;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    const operations = this.#operationQueue;
    this.#operationQueue = [];
    this.#rateLimited = false;
    for (const op of operations) {
      op.cancelled = true;
      op.reject(new Error('Fetching stopped'));
    }
    this.#showQueueSize();
  }

  // Accept new operations again after stop().
  start() {
    this.#stopped = false;
  }

  get stopped() {
    return this.#stopped;
  }

  #showQueueSize() {
    this.queueSizeView(this.#operationQueue.length, this.#rateLimited);
  }

  async connect() {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve();
      } else {
        Geni.connect((response) => {
          // Without an answer if the SDK already had an access token.
          if (
            response?.status == 'authorized' ||
            (response === undefined && Geni._access_token)
          ) {
            console.log('Geni connected');
            this.connected = true;
            this.#rememberLogin();
            resolve();
          } else {
            console.log('Geni connection failed:', response);
            reject('Connect failed, status is ' + response?.status);
          }
        });
      }
    });
  }

  async getPerson(guid) {
    return new Promise((resolve, reject) => {
      const op = new GeniOperation(
        '/profile' + '-g' + guid,
        profileParams,
        resolve,
        reject,
        (error, operation) => this.onCallbackError(error, operation),
      );
      this.#enqueue(op);
    });
  }

  async getPersonByUrl(url) {
    return new Promise((resolve, reject) => {
      const urlOp = urlToId(url);
      const op = new GeniOperation(
        urlOp,
        profileParams,
        resolve,
        reject,
        (error, operation) => this.onCallbackError(error, operation),
      );
      this.#enqueue(op);
    });
  }

  async getPathTo(fromProfileId, toProfileId, pathType = 'blood') {
    return new Promise((resolve, reject) => {
      const from = urlToId(fromProfileId);
      const to = urlToId(toProfileId);
      const op = new GeniOperation(
        '/' + from + '/path-to/' + to,
        { path_type: pathType },
        resolve,
        reject,
        (error, operation) => this.onCallbackError(error, operation),
      );
      this.#enqueue(op);
    });
  }

  // Geni also has a profile/ancestors call, returning 5 generations of
  // ancestors at once. It is not used, because Geni only allows it for
  // the logged-in user's own profile, and answers "Permission denied"
  // for any other, including the user's ancestors and profiles the user
  // manages. Its generations parameter fails with "comparison of Integer
  // with String failed", whether given as a number or as text.

  async getUnions(unions) {
    return new Promise((resolve, reject) => {
      const op = new GeniOperation(
        '/union',
        { ids: unions },
        resolve,
        reject,
        (error, operation) => this.onCallbackError(error, operation),
      );
      this.#enqueue(op);
    });
  }
}
