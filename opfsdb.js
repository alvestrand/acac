// Implements a database that loads and stores itself to
// a file named 'GeniDatabase'
// in the Origin Private File System.
//
// The file also holds the groups, the current group of the tab that
// saved last, and a version number that is incremented on each save. Several tabs may use the file at the same
// time. Each tab remembers the version it last loaded or saved; if the
// stored version is higher when the tab saves, another tab has saved in
// between, and the stored database and groups are merged into the
// tab's before the file is written.
import { Database } from './database.js';
import { GroupStore, mergeGroups, readStoredGroups } from './groups.js';

export { DatabaseFile };

const databaseName = 'GeniDatabase';
// replace moves the file it replaces to this name, replacing an earlier
// one, in case its contents are still wanted.
const replacedName = 'GeniDatabase.old';
// The key under which older versions kept the current group in
// localStorage.
const legacyCurrentGroupKey = 'currentSet';
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
  #legacyStorage;
  #groupStore = new GroupStore();
  // The version of the file that the tab's data is based on.
  #loadedVersion = 0;
  // The groups as of the last load or save, which the groups in the
  // file are compared with when merging.
  #baseGroups = {};
  // The current group found by load, or undefined.
  #storedCurrentGroup;

  // legacyStorage (normally localStorage) holds the groups and current
  // group of older versions. The groups are moved into the file the
  // first time it is loaded without any; legacyStorage is only read.
  constructor(legacyStorage, environment = browserEnvironment) {
    this.#environment = environment;
    this.#legacyStorage = legacyStorage;
  }

  // The groups, kept in the file together with the database.
  get groupStore() {
    return this.#groupStore;
  }

  // The current group of the tab that saved the file last, as found by
  // load, for a new tab to start with. Taken from legacyStorage if the
  // file has none. Undefined if neither has one.
  get storedCurrentGroup() {
    return this.#storedCurrentGroup;
  }

  // Load the database and the groups from the file. Returns true if the
  // groups were taken from the older storage, in which case they should
  // be saved.
  async load(db) {
    const fileHandle = await this.#getFileHandle(false);
    let parsed;
    if (fileHandle) {
      // Read under the lock: a file read while another tab saves it
      // fails with NotReadableError.
      const data = await this.#withLock(async () =>
        (await fileHandle.getFile()).text(),
      );
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
    this.#storedCurrentGroup =
      typeof parsed?.currentGroup === 'string'
        ? parsed.currentGroup
        : (this.#legacyStorage.getItem(legacyCurrentGroupKey) ?? undefined);
    if (parsed && 'groups' in parsed) {
      this.#groupStore.replaceAll(parsed.groups);
      this.#baseGroups = this.#groupStore.toObject();
      return false;
    }
    // No groups in the file: take them from the older storage. The base
    // stays empty, so that all of them count as added by this tab.
    this.#baseGroups = {};
    const oldGroups = readStoredGroups(this.#legacyStorage);
    this.#groupStore.replaceAll(oldGroups);
    return Object.keys(oldGroups).length > 0;
  }

  // Save the database and the groups, merging in what other tabs saved
  // since this tab loaded or saved, and currentGroup, the tab's current
  // group, unless it is undefined. Returns the new version, whether
  // anything was merged into the database or groups, the names of the
  // groups whose notes were changed in both tabs, and how many persons
  // the merge added to the database.
  async save(db, currentGroup) {
    const startTime = performance.now();
    const result = await this.#withLock(() =>
      this.#saveLocked(db, currentGroup),
    );
    console.log(
      'Database saved in',
      Math.round(performance.now() - startTime),
      'ms, version',
      result.version,
    );
    return result;
  }

  async #saveLocked(db, currentGroup) {
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
    await this.#write(fileHandle, db, currentGroup, version);
    return { version, merged, conflicts, added };
  }

  // Replace the file with the database and the groups, without reading
  // or merging what is stored: for loading a backup, which must work
  // also when the stored file cannot be read. The old file is moved to
  // replacedName, or deleted if it cannot be moved. The new file gets a
  // higher version than the old one, when that can be read, and than
  // this tab has seen, so that other tabs merge it rather than save
  // over it. Returns the new version.
  async replace(db, currentGroup) {
    return this.#withLock(async () => {
      const directory = await this.#environment.directory();
      let storedVersion = 0;
      const old = await this.#getFileHandle(false);
      if (old) {
        try {
          storedVersion = await readVersion(old);
        } catch (error) {
          console.log('Could not read the version of the replaced file', error);
        }
        await this.#moveAside(directory, old);
      }
      const version = Math.max(storedVersion, this.#loadedVersion) + 1;
      await this.#write(
        await this.#getFileHandle(true),
        db,
        currentGroup,
        version,
      );
      console.log('Database replaced, version', version);
      return version;
    });
  }

  // Move the database file to replacedName, or delete it if that fails.
  async #moveAside(directory, fileHandle) {
    try {
      await directory.removeEntry(replacedName);
    } catch (error) {
      if (error.name !== 'NotFoundError') {
        console.log('Could not remove', replacedName, error);
      }
    }
    try {
      await fileHandle.move(replacedName);
      console.log('Moved the old database file to', replacedName);
    } catch (error) {
      console.log('Could not move the old database file, deleting it', error);
      await directory.removeEntry(databaseName);
    }
  }

  // Write the database, the groups and the current group to the file as
  // the given version, and make that the version this tab is based on.
  async #write(fileHandle, db, currentGroup, version) {
    const groups = this.#groupStore.toObject();
    const writable = await fileHandle.createWritable();
    await writable.write(
      JSON.stringify(
        { version, ...db.toJsonObject(), groups, currentGroup },
        null,
        2,
      ),
    );
    await writable.close();
    this.#loadedVersion = version;
    this.#baseGroups = groups;
  }

  // The database and groups stored in the file, or undefined if its
  // contents are not a database, in which case it is overwritten. An
  // error reading the file is thrown, so that the save is abandoned and
  // the file is kept.
  async #parseStored(fileHandle) {
    const text = await (await fileHandle.getFile()).text();
    try {
      const parsed = JSON.parse(text);
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

  // Run the function while no other tab is reading or saving the file.
  // Without the Web Locks API, tabs are not kept apart.
  #withLock(callback) {
    const locks = this.#environment.locks;
    return locks ? locks.request(lockName, callback) : callback();
  }
}
