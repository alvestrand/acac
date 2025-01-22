// This module offers an interface to Geni that will use Fetch to get persons and ancestors of persons.
// It maintains a queue of operations, and will execute them as fast as the Geni rate limit permits.
// It assumes that the Geni API is available in the global environment (todo: inject it)

export { GeniClient };
import { urlToId } from './geni_structures.js';

class GeniOperation {

  constructor(operation, args, resolve, reject) {
    this.operation = operation;
    this.args = args;
    this.resolve = resolve;
    this.reject = reject;
    this.active = false;
    this.fulfilled = false;
  }

  execute() {
    this.active = true;
    try {
      // Geni modifies the args argument, so clone it.
      const args = structuredClone(this.args);
      Geni.api(this.operation, args, data => {
        if (data.error) {
          if (data.error.type == 'ApiException'
              && data.error.message == 'Rate limit exceeded.') {
            // Not fulfilled, will be retried in next round
          } else {
            console.log('Operation failed with error', data.error);
            this.fulfilled = true;
            this.reject(data.error);
          }
        } else {
          this.fulfilled = true;
          this.resolve(data);
        }
        this.active = false;
      });
    }
    catch (error) {
      console.log('Operation threw an error');
      this.fulfilled = true;
      this.reject(error);
    }
  }
}

class GeniClient {
  #operationQueue;

  constructor(appId) {
    this.connected = false;
    this.#operationQueue = [];
    this.queueSizeView = number => {};
    Geni.init({
      app_id: appId,
      cookie: true,
      logging: false,
    });
  }

  runOperations() {
    if (this.#operationQueue.length > 0) {
      const op = this.#operationQueue[0];
      // Operations get fulfilled asynchronously.
      if (op.fulfilled) {
        this.#operationQueue.shift();
        if (this.#operationQueue.length > 0) {
          this.#operationQueue[0].execute();
        }
      } else if (op.active) {
        // return later
      } else {
        op.execute();
      }
      setTimeout(this.runOperations.bind(this), 5000);
    }
    this.queueSizeView(this.#operationQueue.length);
  }

  async connect() {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve();
      } else {
        Geni.connect(response => {
          if (response.status == 'authorized') {
            console.log('Geni connected');
            this.connected = true;
            resolve();
          } else {
            reject('Connect failed, status is ' + response.status);
          }
        });
      }
    });
  }

  async getPerson(guid) {
    return new Promise((resolve, reject) => {
      const op = new GeniOperation('/profile' + '-g' + guid, [],
                             resolve, reject);
      this.#operationQueue.push(op);
      this.runOperations();
    });
  }

  async getPersonByUrl(url) {
    return new Promise((resolve, reject) => {
      const urlOp = urlToId(url);
      const op = new GeniOperation(urlOp, [], resolve, reject);
      this.#operationQueue.push(op);
      this.runOperations();
    });
  }

  async getUnions(unions) {
    return new Promise((resolve, reject) => {
      const op = new GeniOperation('/union', {ids: unions},
                                   resolve, reject);
      this.#operationQueue.push(op);
      this.runOperations();
    });
  }
}
