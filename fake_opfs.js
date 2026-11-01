// Minimal in-memory fakes of the Origin Private File System directory
// and the Web Locks API, for use in tests of opfsdb.js.

class FakeFileHandle {
  constructor() {
    this.content = '';
  }
  async getFile() {
    return new Blob([this.content]);
  }
  // Like the real one, the content is replaced only when closed.
  async createWritable() {
    const handle = this;
    let pending = '';
    return {
      async write(data) {
        pending += data;
      },
      async close() {
        handle.content = pending;
      },
    };
  }
}

class FakeDirectory {
  #files = new Map();
  async getFileHandle(name, { create = false } = {}) {
    if (!this.#files.has(name)) {
      if (!create) {
        const error = new Error('File not found');
        error.name = 'NotFoundError';
        throw error;
      }
      this.#files.set(name, new FakeFileHandle());
    }
    return this.#files.get(name);
  }
}

// Runs requests with the same name one at a time, in order.
class FakeLocks {
  #queues = new Map();
  request(name, callback) {
    const previous = this.#queues.get(name) ?? Promise.resolve();
    const result = previous.then(callback);
    this.#queues.set(
      name,
      result.catch(() => {}),
    );
    return result;
  }
}

// An environment for DatabaseFile, in which all tabs share one file.
function fakeEnvironment() {
  const directory = new FakeDirectory();
  return { directory: async () => directory, locks: new FakeLocks() };
}

export { FakeDirectory, FakeLocks, fakeEnvironment };
