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

class GeniOperation {
  constructor(operation, args, resolve, reject) {
    this.operation = operation;
    this.args = args;
    this.resolve = resolve;
    this.reject = reject;
    // Set when the client stops fetching. Geni's answer is then ignored.
    this.cancelled = false;
  }

  // Run the operation. Calls done with 'rateLimited' when Geni says the
  // rate limit is exceeded, in which case the operation should be run
  // again later. Otherwise the operation is resolved or rejected, and
  // done is called with 'answered' if Geni answered, or 'failed' if the
  // call to Geni threw.
  execute(done) {
    try {
      // Geni modifies the args argument, so clone it.
      const args = structuredClone(this.args);
      Geni.api(this.operation, args, (data) => {
        if (this.cancelled) {
          return;
        }
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
        } else {
          this.resolve(data);
        }
        done('answered');
      });
    } catch (error) {
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

  constructor(appId) {
    this.connected = false;
    this.#operationQueue = [];
    // Called with the number of queued operations, and whether the
    // connection is waiting for the Geni rate limit.
    this.queueSizeView = (number, waiting) => {};
    Geni.init({
      app_id: appId,
      cookie: true,
      logging: false,
    });
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
      if (outcome === 'rateLimited') {
        this.#rateLimited = true;
        this.#retryTimer = setTimeout(() => {
          this.#retryTimer = undefined;
          this.#execute(op);
        }, rateLimitRetryDelay);
      } else {
        if (outcome === 'answered') {
          this.#rateLimited = false;
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
          if (response?.status == 'authorized') {
            console.log('Geni connected');
            this.connected = true;
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
      );
      this.#enqueue(op);
    });
  }

  async getPersonByUrl(url) {
    return new Promise((resolve, reject) => {
      const urlOp = urlToId(url);
      const op = new GeniOperation(urlOp, profileParams, resolve, reject);
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
      const op = new GeniOperation('/union', { ids: unions }, resolve, reject);
      this.#enqueue(op);
    });
  }
}
