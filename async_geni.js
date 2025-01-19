// This module offers an interface to Geni that will use Fetch to get persons and ancestors of persons.
// It maintains a queue of operations, and will execute them as fast as the Geni rate limit permits.
// It assumes that the Geni API is available in the global environment (todo: inject it)

export { GeniClient };

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
    console.log('Executing ', this.operation, this.args);
    try {
      // Geni modifies the args argument, so clone it.
      const args = structuredClone(this.args);
      Geni.api(this.operation, args, data => {
        console.log('operation returned', data);
        if (data.error) {
          if (data.error.type == 'ApiException'
              && data.error.message == 'Rate limit exceeded.') {
            console.log('Rate limited');
            // Not fulfilled, will be retried in next round
          } else {
            console.log('Operation failed');
            this.fulfilled = true;
            this.reject(data.error);
          }
        } else {
          this.fulfilled = true;
          this.resolve(data);
        }
      });
    }
    catch (error) {
      console.log('Operation threw an error');
      this.fulfilled = true;
      this.reject(error);
    }
    finally {
      this.active = false;
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
        logging: true,
     });
  }

  runOperations() {
    if (this.#operationQueue.length > 0) {
      console.log('Op queue length is ', this.#operationQueue.length);
      const op = this.#operationQueue[0];
      // Operations get fulfilled asynchronously.
      if (op.fulfilled) {
        console.log('Op finished');
        this.#operationQueue.shift();
        if (this.#operationQueue.length > 0) {
          console.log('Next op executing');
          this.#operationQueue[0].execute();
        }
      } else if (op.active) {
        // return later
        console.log('Op active');
      } else {
        console.log('Op executing');
        op.execute();
      }
      setTimeout(this.runOperations.bind(this), 5000);
    }
    this.queueSizeView(this.#operationQueue.length);
  }

  async connect() {
    return new Promise((resolve, reject) => {
      Geni.connect(response => {
        if (response.status == 'authorized') {
          console.log('Geni connected');
          this.connected = true;
          resolve();
        } else {
          reject('Connect failed, status is ' + response.status);
        }
      });
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
      const urlOp = url.replace('https://www.geni.com.api/', '');
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
