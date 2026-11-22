// Minimal in-memory fakes of the Origin Private File System directory
// and the Web Locks API, for use in tests of opfsdb.js.

class FakeFileHandle {
  constructor(directory, name) {
    this.directory = directory;
    this.name = name;
    this.content = '';
    // When true, reading the whole file fails with NotReadableError, as
    // when another tab has saved it since the File was taken. Reading
    // its start, for the version, still works.
    this.failReads = false;
  }
  async getFile() {
    const blob = new Blob([this.content]);
    if (!this.failReads) {
      return blob;
    }
    return {
      slice: (start, end) => blob.slice(start, end),
      async text() {
        const error = new Error('The requested file could not be read');
        error.name = 'NotReadableError';
        throw error;
      },
    };
  }
  // Rename the file in its directory. Fails if a file of that name
  // exists, or if the directory's canMove is false.
  async move(newName) {
    this.directory.rename(this.name, newName);
    this.name = newName;
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

function notFound() {
  const error = new Error('File not found');
  error.name = 'NotFoundError';
  return error;
}

class FakeDirectory {
  #files = new Map();
  // When false, moving files fails, as in browsers without move.
  canMove = true;
  async getFileHandle(name, { create = false } = {}) {
    if (!this.#files.has(name)) {
      if (!create) {
        throw notFound();
      }
      this.#files.set(name, new FakeFileHandle(this, name));
    }
    return this.#files.get(name);
  }
  async removeEntry(name) {
    if (!this.#files.delete(name)) {
      throw notFound();
    }
  }
  rename(name, newName) {
    if (!this.canMove || this.#files.has(newName)) {
      throw new Error('Cannot move ' + name + ' to ' + newName);
    }
    this.#files.set(newName, this.#files.get(name));
    this.#files.delete(name);
  }
  names() {
    return [...this.#files.keys()].sort();
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
