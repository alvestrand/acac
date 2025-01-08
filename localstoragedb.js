// Implements a database that loads and stores itself to localstorage key 'GeniDatabase'
import { Person, Database } from '../database.js';

let db = new Database;
const databaseName = 'GeniDatabase';

function loadDatabase() {
  const data = localStorage.getItem(databaseName);
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

function saveDatabase() {
  try {
    localStorage.setItem(databaseName, db.toJsonString());
  } catch(e) {
    console.log('Database save failed, error = ', e);
  }
}

export { loadDatabase, saveDatabase, db };
