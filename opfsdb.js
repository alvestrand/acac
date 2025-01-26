// Implements a database that loads and stores itself to
// a file named 'GeniDatabase'
// in the Origin Private File System.
export { loadDatabase, saveDatabase };

const databaseName = 'GeniDatabase';

async function loadDatabase(db) {
  const fsHandle = await navigator.storage.getDirectory();
  let fileHandle;
  try {
    fileHandle = await fsHandle.getFileHandle(databaseName);
  } catch(err) {
    if (err.name === 'NotFoundError') {
      console.log('File not found, assuming empty');
      return;
    } else {
      throw err;
    }
  }

  const blob = await fileHandle.getFile();
  const data = await blob.text();
  if (data) {
    try {
      db.fromJsonString(data);
      console.log('Database loaded');
    } catch (error) {
      console.log('Database load failed, error = ', error);
    }
  } else {
    console.log('No database found');
  }
}

async function saveDatabase(db) {
  const estimateBefore = await navigator.storage.estimate();
  console.log('Estimated storage is ', estimateBefore.quota,
              estimateBefore.usage);
  const fsHandle = await navigator.storage.getDirectory();
  const fileHandle = await fsHandle.getFileHandle(databaseName, {
    create: true
  });
  const writable = await fileHandle.createWritable();
  await writable.write(db.toJsonString());
  await writable.close();
  const estimateAfter = await navigator.storage.estimate();
  console.log('Estimated storage after is ', estimateAfter.quota,
              estimateAfter.usage);
}
