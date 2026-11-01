// Implements a database that loads and stores itself to
// a file named 'GeniDatabase'
// in the Origin Private File System.
//
// The file also holds the groups, and a version number that is
// incremented on each save. Several tabs may use the file at the same
// time. Each tab remembers the version it last loaded or saved; if the
// stored version is higher when the tab saves, another tab has saved in
// between, and the stored database and groups are merged into the
// tab's before the file is written.
import { Database } from './database.js';
import { GroupStore, MemoryStorage, mergeGroups } from './groups.js';

export { DatabaseFile };

const databaseName = 'GeniDatabase';
const lockName = 'acac-database';

// The browser's file system and lock manager, used unless others are
// passed to DatabaseFile (for tests).
const browserEnvironment = {
  directory: () => navigator.storage.getDirectory(),
  locks: typeof navigator === 'undefined' ? undefined : navigator.locks,
};

// The version is the first key in the file, so that it can be found
// without reading the whole file. Files from older versions have none.
async function readVersion(fileHandle) {
  const blob = await fileHandle.getFile();
  const head = await blob.slice(0, 100).text();
  const match = /^\{\s*"version":\s*(\d+)/.exec(head);
  return match ? Number(match[1]) : 0;
}

class DatabaseFile {
  #environment;
  #currentStorage;
  // Where groups are kept for the current group name, which each tab
  // keeps for itself.
  #groupMemory = new MemoryStorage();
  #groupStore;
  // The version of the file that the tab's data is based on.
  #loadedVersion = 0;
  // The groups as of the last load or save, which the groups in the
  // file are compared with when merging.
  #baseGroups = {};

  // currentStorage (normally localStorage) holds the name of the current
  // group, and the groups of older versions, which are moved into the
  // file the first time it is loaded without any.
  constructor(currentStorage, environment = browserEnvironment) {
    this.#environment = environment;
    this.#currentStorage = currentStorage;
    this.#groupStore = new GroupStore(this.#groupMemory, currentStorage);
  }

  // The groups, kept in the file together with the database.
  get groupStore() {
    return this.#groupStore;
  }

  // Load the database and the groups from the file. Returns true if the
  // groups were taken from the older storage, in which case they should
  // be saved.
  async load(db) {
    const fileHandle = await this.#getFileHandle(false);
    let parsed;
    if (fileHandle) {
      const data = await (await fileHandle.getFile()).text();
      if (data) {
        try {
          parsed = JSON.parse(data);
          db.fromJsonObject(parsed);
          this.#loadedVersion = parsed.version ?? 0;
          console.log('Database loaded, version', this.#loadedVersion);
        } catch (error) {
          console.log('Database load failed, error = ', error);
          parsed = undefined;
        }
      } else {
        console.log('No database found');
      }
    } else {
      console.log('File not found, assuming empty');
    }
    if (parsed && 'groups' in parsed) {
      this.#groupStore.replaceAll(parsed.groups);
      this.#baseGroups = this.#groupStore.toObject();
      return false;
    }
    // No groups in the file: take them from the older storage. The base
    // stays empty, so that all of them count as added by this tab.
    this.#baseGroups = {};
    const oldGroups = new GroupStore(this.#currentStorage).toObject();
    this.#groupStore.replaceAll(oldGroups);
    return Object.keys(oldGroups).length > 0;
  }

  // Save the database and the groups, merging in what other tabs saved
  // since this tab loaded or saved. Returns the new version, whether
  // anything was merged into the database or groups, the names of the
  // groups whose notes were changed in both tabs, and how many persons
  // the merge added to the database.
  async save(db) {
    const startTime = performance.now();
    const result = await this.#withLock(() => this.#saveLocked(db));
    console.log(
      'Database saved in',
      Math.round(performance.now() - startTime),
      'ms, version',
      result.version,
    );
    return result;
  }

  async #saveLocked(db) {
    const fileHandle = await this.#getFileHandle(true);
    const storedVersion = await readVersion(fileHandle);
    let merged = false;
    let conflicts = [];
    let added = 0;
    if (storedVersion > this.#loadedVersion) {
      const stored = await this.#parseStored(fileHandle);
      if (stored) {
        added = db.mergeFrom(stored.db).added;
        const groups = mergeGroups(
          this.#baseGroups,
          this.#groupStore.toObject(),
          stored.groups ?? this.#baseGroups,
          (id) => db.currentId(id),
        );
        this.#groupStore.replaceAll(groups.groups);
        conflicts = groups.conflicts;
        merged = true;
      }
    }
    const version = Math.max(storedVersion, this.#loadedVersion) + 1;
    const groups = this.#groupStore.toObject();
    const writable = await fileHandle.createWritable();
    await writable.write(
      JSON.stringify({ version, ...db.toJsonObject(), groups }, null, 2),
    );
    await writable.close();
    this.#loadedVersion = version;
    this.#baseGroups = groups;
    return { version, merged, conflicts, added };
  }

  // The database and groups stored in the file, or undefined if it
  // can't be read, in which case it is overwritten.
  async #parseStored(fileHandle) {
    try {
      const parsed = JSON.parse(await (await fileHandle.getFile()).text());
      const stored = new Database();
      stored.fromJsonObject(parsed);
      return { db: stored, groups: parsed.groups };
    } catch (error) {
      console.log('Stored database unreadable, overwriting. Error = ', error);
      return undefined;
    }
  }

  // Returns undefined if the file doesn't exist and create is false.
  async #getFileHandle(create) {
    const directory = await this.#environment.directory();
    try {
      return await directory.getFileHandle(databaseName, { create });
    } catch (err) {
      if (err.name === 'NotFoundError') {
        return undefined;
      }
      throw err;
    }
  }

  // Run the function while no other tab is saving. Without the Web Locks
  // API, tabs are not kept from saving at the same time.
  #withLock(callback) {
    const locks = this.#environment.locks;
    return locks ? locks.request(lockName, callback) : callback();
  }
}
