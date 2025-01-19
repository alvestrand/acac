import { Person, Database } from './database.js';
import { GeniClient } from './async_geni.js';
import { resolveParents } from './geni_structures.js';
import { loadDatabase, saveDatabase, db } from './localstoragedb.js';

// Pick up the Geni application id
let geniAppId;
try {
  const response = await fetch('.geni_app_id');
  if (response.ok) {
    geniAppId = await response.text();
    geniAppId = geniAppId.replace(/^\s+/gm, '');
    console.log('Geni API is ', geniAppId);
  } else {
    console.log('Fetching Geni API key failed');
  }
} catch(err) {
  console.log('Fetching Geni API threw, error ', err);
}

const client = new GeniClient(geniAppId);
client.queueSizeView = number => {
  queueSizeElement.innerText = number;
}

let profileList = [];

// Utility functions
function isolateId(url) {
  const basepart = url.split('?')[0];
  const parts = basepart.split('/');
  return parts[parts.length-1];
}

// Get UI elements from HTML file.
const groupNameElement = document.getElementById('group-name');
const addProfileElement = document.getElementById('add-profile');
const addProfileButton = document.getElementById('add-profile-now');
const addProfileMessage = document.getElementById('add-profile-message');
const profileListElement = document.getElementById('profile-list');
const queueSizeElement = document.getElementById('queue-size');
const saveDatabaseButton = document.getElementById('save-database');

// Initialize the page from last saved state
loadDatabase();
groupNameElement.value = localStorage.getItem('currentSet');
let groupName = 'profileSet-' + groupNameElement.value;
let profileListString = localStorage.getItem(groupName);
if (profileListString) {
  profileList = JSON.parse(profileListString);
  displayProfileList();
}

function displayProfileList() {
  profileListElement.innerHTML = '';
  profileList.forEach(profile => {
    const {id, name} = profile;
    console.log(id, name);
    const p = document.createElement('p');
    p.textContent = `${id} ${name}`;
    profileListElement.append(p);
  });
}

function addNameToProfileList(person) {
  if (profileList.find(entry => entry.id == person.guid())) {
    console.log('Profile already in list');
  } else {
    profileList.push({id: person.guid(), name: person.name()});
    displayProfileList();
  }
}


async function addProfile() {
  try {
    if (!client.connected) {
      await client.connect();
    }
    const guid = isolateId(addProfileElement.value);
    const stored = db.get(guid);
    if (stored) {
      console.log('guid ', guid, ' already in DB');
      addProfileMessage.innerText = stored.name() + ' already in DB';
      addNameToProfileList(stored);
      addProfileElement.value = '';
      if (!('parents' in stored)) {
        console.log('Getting parents of stored profile', stored.guid());
        await addParents(stored);
      }
      return;
    }
    console.log('Adding profile ', guid);
    const fetched = await client.getPerson(guid);
    if (!('guid' in fetched)) {
      console.log('No guid, no profile?');
      addProfileMessage.innerText = 'Add did not find a profile';
      return;
    }
    const person = db.addWithAttributes(fetched.guid, fetched);
    addNameToProfileList(person);
    addProfileElement.value = '';
    addParents(person);
  } catch (error) {
    console.log('Add failed, message ', error);
    addProfileMessage.innerText = 'Add failed, error ' + JSON.stringify(error);
    return;
  }
}

// This function takes a person record and adds a parent array to it.
// It modifies the passed person.
async function addParents(person) {
  let unions;
  try {
    // Trigger fetching of parents.
    console.log('Fetching unions');
    const strippedUnions = person.unions().map(str => {
      return str.split('-')[1];
    });
    console.log('Stripped unions: ', strippedUnions);
    const result = await client.getUnions(strippedUnions);
    if ('results' in result) {
      unions = result.results;
      console.log('Unions fetched:', unions);
    } else {
      console.log('No results in result', result);
      addProfileMessage.innerText = 'Finding unions gave empty result';
      return;
    }
  } catch(error) {
    console.log('Fetch unions failed, message ', error);
    return;
  }
  const parents = resolveParents(person, unions);
  console.log('Parents found:', parents);
  // We don't know which parent is father at this point. Just store,
  // and resolve when we know more.
  person.parents = parents;
}

groupNameElement.addEventListener('change', () => {
  profileList.clear();
  displayProfileList();
});

addProfileElement.addEventListener('change', async () => {
  console.log('Change event detected');
  addProfile();
});

addProfileButton.addEventListener('click', async () => {
  console.log('Click detected');
  addProfile();
});

saveDatabaseButton.addEventListener('click', () => {
  saveDatabase();
  localStorage.setItem('profileSet-'+ groupNameElement.value,
                       JSON.stringify(profileList));
  localStorage.setItem('currentSet', groupNameElement.value);
});
