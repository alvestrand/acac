import { Person, Database } from './database.js';
import { GeniClient } from './async_geni.js';
import { urlToId, resolveParents } from './geni_structures.js';
import { loadDatabase,
         saveDatabase } from './opfsdb.js';
import {
  CommonAncestorGroup,
  mergeWithSomeGroup,
  makeGroupList,
  removeInnerParents
} from './ancestor_finder.js';

let db = new Database;

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
let ancestorGroups = [];

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
const buildTreeButton = document.getElementById('build-tree');
const yearLimitElement = document.getElementById('year-limit');
const recalculateGroupsButton = document.getElementById('recalculate-groups');
const groupListElement = document.getElementById('group-list');

function loadProfileList() {
  let groupName = 'profileSet-' + groupNameElement.value;
  let profileListString = localStorage.getItem(groupName);
  if (profileListString) {
    const profileIdName = JSON.parse(profileListString);
    profileList = profileIdName.map(entry => {
      const profile = db.get(entry.id);
      if (profile) {
        return profile;
      } else {
        return db.addWithAttributes(entry.id, entry.attributes);
      }
    });
  } else {
    profileList = new Array();
  }
  displayProfileList();
}

function displayProfileList() {
  profileListElement.innerHTML = '';
  const table = document.createElement('table');
  const th = document.createElement('tr');
  th.innerHTML = '<tr><th>ID<th>Name<th>Ancestors</tr>';
  table.append(th);

  profileList.forEach(profile => {
    const row = document.createElement('tr');
    const p = document.createElement('td');
    p.textContent = profile.id();
    row.append(p);
    const n = document.createElement('td');
    n.textContent = profile.name();
    row.append(n);
    const a = document.createElement('td');
    a.textContent = profile.ancestors().size;
    row.append(a);
    table.append(row);
  });
  profileListElement.append(table);
}

function addNameToProfileList(person) {
  if (profileList.find(entry => entry.guid() == person.guid())) {
    console.log('Profile already in list');
    return false;
  } else {
    profileList.push(person);
    displayProfileList();
    return true;
  }
}

let profileBeingFetched;

async function addProfile() {
  try {
    if (!client.connected) {
      await client.connect();
    }
    const guid = isolateId(addProfileElement.value);
    if (guid === profileBeingFetched) {
      console.log('addProfile called twice on', guid, ', ignoring');
      return;
    }
    addProfileMessage.innerText = 'Fetching id ' + guid;
    profileBeingFetched = guid;
    const stored = db.get(guid);
    let fetched;
    if (stored) {
      console.log('guid ', guid, ' already in DB');
      const mergedTo = stored.attribute('merged_into');
      if (mergedTo === undefined) {
        // Profile is OK
        addProfileMessage.innerText = stored.name() + ' already in DB';
        if (addNameToProfileList(stored)) {
          addProfileElement.value = '';
          if (!('parents' in stored)) {
            console.log('Getting parents of stored profile', stored.guid());
            await addParents(stored);
          }
          console.log('Building tree for added person', stored.name());
          addProfileMessage.innerText = 'Building tree for ' + stored.name();
          await buildTreeForPerson(stored, 2025, Number(yearLimitElement.value));
          buildAncestorGroups();
          addProfileMessage.innerText = 'Finished tree building for ' + stored.name();
          return;
        }
      }
      console.log('Following merged-to pointer', mergedTo);
      fetched = await client.getPersonByUrl(mergedTo);
    } else {
      console.log('Adding profile ', guid);
      fetched = await client.getPerson(guid);
    }
    if ('merged_into' in fetched) {
      // We assume that this goes only one level deep.
      console.log('Follwing merged-to pointer from newly fetched');
      fetched = await client.getPersonByUrl(fetched.merged_into);
    }
    if (!('guid' in fetched)) {
      console.log('No guid, no profile?');
      addProfileMessage.innerText = 'Add did not find a profile';
      return;
    }
    const person = db.addWithAttributes(fetched.guid, fetched);
    addNameToProfileList(person);
    addProfileElement.value = '';
    await addParents(person);
    console.log('Building tree for added person', person.name());
    addProfileMessage.innerText = 'Building tree for ' + person.name();
    await buildTreeForPerson(person, 2025, Number(yearLimitElement.value));
    buildAncestorGroups();
    addProfileMessage.innerText = 'Finished tree building for ' + person.name();
  } catch (error) {
    console.log('Add failed, message ', error);
    addProfileMessage.innerText = 'Add failed, error ' + JSON.stringify(error);
    return;
  }
}

async function addProfileByUrl(url) {
  try {
    console.log('Adding profile ', url);
    const fetched = await client.getPersonByUrl(url);
    if (!('guid' in fetched)) {
      console.log('No guid, no profile?');
      return;
    }
    const person = db.addWithAttributes(fetched.guid, fetched);
    console.log('Added', person.name());
    await addParents(person);
    console.log('Added parents for ', person.name());
    return person;
  } catch (error) {
    console.log('AddProfileByUrl failed, message ', error);
    return;
  }
}

// This function takes a person record and adds a parent array to it.
// It modifies the passed person.
// It depends on unions being present in the record.
async function addParents(person) {
  let unions;
  if (!person.unions()) {
    console.log('No unions on ', person.id(), person.name());
    return;
  }
  if (person.parents && person.parents !== undefined) {
    console.log('Already have parents on', person.name());
  }
  // Trigger fetching of parents.
  console.log('Fetching unions');
  const strippedUnions = person.unions().map(str => {
    return str.split('-')[1];
  });
  console.log('Stripped unions: ', strippedUnions);
  try {
    const result = await client.getUnions(strippedUnions);
    if ('results' in result) {
      unions = result.results;
      console.log('Unions fetched:', unions);
    } else if ('id' in result) {
      // When a single result is returned, it's returned
      // without a containing "results" array.
      unions = [ result ];
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

let building = false;

async function buildTreeForPerson(person, birthYearAssumption, yearLimit) {
  if (!person) {
    console.log('Error: Called with no person');
    return;
  }
  const birth = person.attribute('birth');
  let birthYear = birthYearAssumption;
  if (birth && 'date' in birth
      && 'year' in birth.date) {
    birthYear = birth.date.year + 0;
  }
  if (birthYear < yearLimit) {
    console.log(`${person.name()} seems born in ${birthYear} - not looking`);
    return;
  }
  if (!('parents' in person) || person.parents === undefined) {
    await addParents(person);
  }
  if (!('parents' in person) || person.parents === undefined) {
    console.log('Could not fetch parents for ', person.name());
    return;
  }
  if (!person.father() || !person.mother()) {
    // Fill in person records for father and mother.
    const promises = person.parents.map(async parentId => {
      let parentPerson = db.getByIdAttribute(urlToId(parentId));
      if (!parentPerson) {
        parentPerson = await addProfileByUrl(parentId);
      }
      if (!parentPerson) {
        console.log('Unable to fetch', parentId);
        return;
      }
      if (parentPerson.gender() == 'male') {
        person.setFather(parentPerson.id());
      } else {
        person.setMother(parentPerson.id());
      }
    });
    await Promise.all(promises);
  }
  if (person.father()) {
    let dbFather = db.get(person.father());
    if (!dbFather) {
      // somehow ref to father got stored, but not father
      const fetched = await client.getPerson(person.father());
      dbFather = db.addWithAttributes(fetched.guid, fetched);
    }
    await buildTreeForPerson(dbFather, birthYear - 30, yearLimit);
  }
  if (person.mother()) {
    let dbMother = db.get(person.mother());
    if (!dbMother) {
      // somehow ref to mother got stored, but not mother
      const fetched = await client.getPerson(person.mother());
      dbMother = db.addWithAttributes(fetched.guid, fetched);
    }
    await buildTreeForPerson(dbMother, birthYear - 30, yearLimit);
  }
}

async function buildTree(yearLimit) {
  await client.connect();
  for (const person of profileList) {
    console.log('Starting tree for root person', person.name());
    await buildTreeForPerson(person, 2025, yearLimit);
  }
  console.log('Tree build finished, computing ancestor groups');
  buildAncestorGroups();
}

function buildAncestorGroups() {
  db.createAncestors();
  ancestorGroups = makeGroupList(profileList);
  console.log('Ancestor groups are', ancestorGroups);
  displayProfileList();
  displayAncestorGroups();
}

function displayAncestorGroups() {
  const dl = document.createElement('dl');

  ancestorGroups.forEach(item => {
    const dt = document.createElement('dt');
    const personArray = item.persons.map(person => person.name());
    personArray.forEach(personName => {
      dt.appendChild(document.createTextNode(personName));
      dt.appendChild(document.createElement('br'));
    });
    const dd = document.createElement('dd');
    if (item.persons.length > 1) {
      const significantAncestors = removeInnerParents(db, item.ancestors);
      const ancestorArray = significantAncestors.values().map(ancestor => {
        return ancestor.name() + ' (' + ancestor.birth() + ')';
      }).toArray();
      console.log('AncestorArray is', ancestorArray);
      ancestorArray.forEach(ancestorName => {
        dd.appendChild(document.createTextNode(ancestorName));
        dd.appendChild(document.createElement('br'));
      });
    } else {
      dd.textContent = `${item.ancestors.size} ancestors`;
    }

    dl.appendChild(dt);
    dl.appendChild(dd);
  });

  groupListElement.innerHTML = '';
  groupListElement.appendChild(dl);
}

// Binding actions to buttons ======================================

groupNameElement.addEventListener('change', () => {
  loadProfileList();
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

saveDatabaseButton.addEventListener('click', async () => {
  await saveDatabase(db);
  localStorage.setItem('profileSet-'+ groupNameElement.value,
                       JSON.stringify(profileList));
  localStorage.setItem('currentSet', groupNameElement.value);
});

buildTreeButton.addEventListener('click', async () => {
  if (!building) {
    building = true;
    buildTreeButton.innerText = 'Stop build';
    await buildTree(Number(yearLimitElement.value));
    buildTreeButton.innerText = 'Build tree';
    building = false;
  } else {
    building = false;
    buildTreeButton.innerText = 'Build tree';
  }
});

recalculateGroupsButton.addEventListener('click', () => {
  buildAncestorGroups();
});

// ===== Initialize the page from last saved state ====
await loadDatabase(db);
console.log('Database size', db.size());
groupNameElement.value = localStorage.getItem('currentSet');
loadProfileList();
buildAncestorGroups();
