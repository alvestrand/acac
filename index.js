import { Person, Database } from './database.js';
import { GeniClient } from './async_geni.js';
import { urlToId, idToUrl, resolveParents } from './geni_structures.js';
import { loadDatabase,
         saveDatabase } from './opfsdb.js';
import { GroupStore } from './groups.js';
import { exportToJsonString,
         parseExport,
         applyImport,
         exportGroupToJsonString,
         parseGroupExport,
         mergeGroupImport } from './file_export.js';
import {
  groupingAlgorithms,
  removeInnerParents
} from './ancestor_finder.js';

let db = new Database;
const cacheSizeElement = document.getElementById('cache-size');
db.sizeView = number => {
  cacheSizeElement.innerText = number;
};

const errorMessageElement = document.getElementById('error-message');

function showErrorMessage(message) {
  errorMessageElement.innerText = message;
  errorMessageElement.hidden = false;
}

function hideErrorMessage() {
  errorMessageElement.hidden = true;
}

// Pick up the Geni application id
let geniAppId;
try {
  const response = await fetch('.geni_app_id');
  if (response.ok) {
    geniAppId = await response.text();
    geniAppId = geniAppId.replace(/^\s+/gm, '');
    console.log('Geni API is ', geniAppId);
    if (geniAppId.trim() === '') {
      console.log('Geni API key file is empty');
      showErrorMessage('Install error: Geni API key missing');
    }
  } else {
    console.log('Fetching Geni API key failed');
    showErrorMessage('Install error: Geni API key missing');
  }
} catch(err) {
  console.log('Fetching Geni API threw, error ', err);
  showErrorMessage('Install error: Geni API key missing');
}
// Don't hide an install error behind the login status.
if (errorMessageElement.hidden) {
  showErrorMessage('Not logged in');
}

const client = new GeniClient(geniAppId);
client.queueSizeView = (number, waiting) => {
  scheduleRunningCounts();
  if (number === 0) {
    queueSizeElement.innerText = 'Queue empty';
  } else {
    queueSizeElement.innerText = 'Queue size: ' + number
      + (waiting ? ' waiting' : '');
  }
}

// Connect to Geni, keeping the error message in sync with login status.
async function connectToGeni() {
  try {
    await client.connect();
    hideErrorMessage();
  } catch (error) {
    showErrorMessage('Login failed');
    throw error;
  }
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
const groupSelectElement = document.getElementById('group-select');
const newGroupBox = document.getElementById('new-group-box');
const newGroupNameElement = document.getElementById('new-group-name');
const newGroupCreateButton = document.getElementById('new-group-create');
const newGroupCancelButton = document.getElementById('new-group-cancel');
const saveGroupButton = document.getElementById('save-group');
const loadGroupButton = document.getElementById('load-group');
const loadGroupInput = document.getElementById('load-group-input');
const groupFileMessage = document.getElementById('group-file-message');
const addProfileElement = document.getElementById('add-profile');
const addProfileButton = document.getElementById('add-profile-now');
const addProfileMessage = document.getElementById('add-profile-message');
const profileListElement = document.getElementById('profile-list');
const queueSizeElement = document.getElementById('queue-size');
const saveDatabaseButton = document.getElementById('save-database');
const exportFileButton = document.getElementById('export-file');
const importFileButton = document.getElementById('import-file');
const importFileInput = document.getElementById('import-file-input');
const buildTreeButton = document.getElementById('build-tree');
const stopFetchingButton = document.getElementById('stop-fetching');
const yearLimitElement = document.getElementById('year-limit');
const recalculateGroupsButton = document.getElementById('recalculate-groups');
const groupListElement = document.getElementById('group-list');
const algorithmSelectElement = document.getElementById('algorithm-select');

// Groups of profiles, saved in the browser's local storage.
const groupStore = new GroupStore(localStorage);
// Name of the group currently being worked on.
let currentGroup = '';
// The "New group..." entry at the end of the group dropdown.
let newGroupOption;

// Fill the group dropdown with all stored groups, plus the current
// group even if it hasn't been saved, and select the current group.
function displayGroupSelect() {
  groupSelectElement.innerHTML = '';
  groupStore.names(currentGroup).forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name === '' ? '(unnamed)' : name;
    groupSelectElement.append(option);
  });
  newGroupOption = document.createElement('option');
  newGroupOption.textContent = 'New group\u2026';
  groupSelectElement.append(newGroupOption);
  groupSelectElement.value = currentGroup;
}

function selectGroup(name) {
  currentGroup = name;
  newGroupBox.hidden = true;
  displayGroupSelect();
  loadProfileList();
}

// Leave the "New group..." state without reloading the current group,
// so that unsaved profiles are kept.
function cancelNewGroup() {
  newGroupBox.hidden = true;
  groupSelectElement.value = currentGroup;
}

function currentProfileIds() {
  return profileList.map(p => p.id());
}

// Save the database and the current group, same as the "Save database" button.
async function saveCurrentState() {
  await saveDatabase(db);
  groupStore.save(currentGroup, currentProfileIds());
  groupStore.setCurrentName(currentGroup);
}

// Save the database and the current group, then switch to another group
// and recalculate its ancestor groups.
async function switchToGroup(name) {
  await saveDatabase(db);
  groupStore.switchTo(currentGroup, currentProfileIds(), name);
  selectGroup(name);
  buildAncestorGroups();
}

async function createNewGroup() {
  const name = groupStore.create(newGroupNameElement.value);
  if (name === null) {
    return;
  }
  await switchToGroup(name);
}

function loadProfileList() {
  // Entries are ids. Older versions stored whole person records,
  // which can be used if the person is missing from the database.
  profileList = groupStore.entries(currentGroup).map(entry => {
    const id = typeof entry === 'string' ? entry : entry.id;
    const profile = db.get(id);
    if (profile) {
      return profile;
    } else if (entry.attributes) {
      return db.addWithAttributes(id, entry.attributes);
    } else {
      console.log('Group member', id, 'not found in database');
      return undefined;
    }
  }).filter(profile => profile);
  displayProfileList();
}

// Returns a link that opens the person's Geni profile in a new tab.
function profileLink(person) {
  const link = document.createElement('a');
  link.href = person.attribute('profile_url') ||
    'https://www.geni.com/people/profile/' + person.guid();
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = person.name();
  return link;
}

// Returns a menu of actions on a profile in the current group.
function profileMenu(profile) {
  const select = document.createElement('select');
  const title = document.createElement('option');
  title.value = '';
  title.textContent = 'Actions\u2026';
  const remove = document.createElement('option');
  remove.value = 'remove';
  remove.textContent = 'Remove from group';
  const rebuild = document.createElement('option');
  rebuild.value = 'rebuild';
  rebuild.textContent = 'Rebuild tree';
  select.append(title, remove, rebuild);
  select.addEventListener('change', () => {
    if (select.value === 'remove') {
      removeFromProfileList(profile);
    } else if (select.value === 'rebuild') {
      rebuildTree(profile);
    }
    select.value = '';
  });
  return select;
}

// While profiles are being fetched, the ancestor counts in the profile
// list are updated at most once per second, so that progress is visible.
// They are worked out from the parent links, since the ancestor sets
// used for the groups are only rebuilt when fetching is finished.
const runningCountsInterval = 1000;
let runningCountsTimer;

function scheduleRunningCounts() {
  if (runningCountsTimer === undefined) {
    runningCountsTimer = setTimeout(() => {
      runningCountsTimer = undefined;
      displayRunningCounts();
    }, runningCountsInterval);
  }
}

// The cell showing the ancestor count of each profile in the list.
// Map of Person -> td element.
let ancestorCountCells = new Map();
// The cell showing the completeness index of each profile in the list.
// Map of Person -> td element.
let completenessCells = new Map();

// The completeness index as shown in the profile list: -log2(1 - index),
// which is n for a tree complete to n generations back.
function formatCompleteness(index) {
  return (-Math.log2(1 - index)).toFixed(1);
}

// Update the ancestor counts and completeness indexes in the profile
// list without redrawing it.
function displayRunningCounts() {
  ancestorCountCells.forEach((cell, profile) => {
    cell.textContent = db.ancestorIds(profile.id()).size;
  });
  const memo = new Map();
  completenessCells.forEach((cell, profile) => {
    cell.textContent = formatCompleteness(
      db.completenessIndex(profile.id(), memo));
  });
}

// Ways of sorting the profile list, chosen by clicking a column heading.
// Each gives a sort key: names A to Z, most complete generations first.
// Only the display is sorted; profileList keeps its order.
const profileSortKeys = {
  name: profile => profile.name() ?? '',
  generations: (profile, memo) => -db.completenessIndex(profile.id(), memo)
};
// The column the list is sorted on, or undefined for the order added.
// Clicking the same heading again reverses the order.
let profileSortColumn;
let profileSortReversed = false;

function sortProfileList(column) {
  if (profileSortColumn === column) {
    profileSortReversed = !profileSortReversed;
  } else {
    profileSortColumn = column;
    profileSortReversed = false;
  }
  displayProfileList();
}

function sortedProfileList() {
  if (profileSortColumn === undefined) {
    return profileList;
  }
  const memo = new Map();
  const key = profileSortKeys[profileSortColumn];
  const keys = new Map(profileList.map(
    profile => [profile, key(profile, memo)]));
  const direction = profileSortReversed ? -1 : 1;
  return profileList.toSorted((a, b) => {
    const keyA = keys.get(a);
    const keyB = keys.get(b);
    const order = typeof keyA === 'string'
      ? keyA.localeCompare(keyB) : keyA - keyB;
    return direction * order;
  });
}

// A column heading that sorts the list on column when clicked.
function sortHeading(text, column) {
  const th = document.createElement('th');
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = text;
  if (profileSortColumn === column) {
    link.textContent += profileSortReversed ? ' \u25b2' : ' \u25bc';
  }
  link.title = 'Sort on this column; click again to reverse';
  link.addEventListener('click', event => {
    event.preventDefault();
    sortProfileList(column);
  });
  th.append(link);
  return th;
}

function displayProfileList() {
  profileListElement.innerHTML = '';
  ancestorCountCells = new Map();
  completenessCells = new Map();
  const table = document.createElement('table');
  const th = document.createElement('tr');
  const ancestorsHeading = document.createElement('th');
  ancestorsHeading.textContent = 'Ancestors';
  th.append(sortHeading('Name', 'name'), ancestorsHeading,
            sortHeading('Generations', 'generations'),
            document.createElement('th'));
  table.append(th);

  // The generations are worked out from the parent links, like the
  // running counts, so that they match the sort order.
  const memo = new Map();
  sortedProfileList().forEach(profile => {
    const row = document.createElement('tr');
    const n = document.createElement('td');
    n.append(profileLink(profile));
    row.append(n);
    const a = document.createElement('td');
    a.textContent = profile.ancestors().size;
    ancestorCountCells.set(profile, a);
    row.append(a);
    const c = document.createElement('td');
    c.textContent = formatCompleteness(
      db.completenessIndex(profile.id(), memo));
    c.title = 'Complete generations: -log2(1 - completeness index)';
    completenessCells.set(profile, c);
    row.append(c);
    const m = document.createElement('td');
    m.append(profileMenu(profile));
    row.append(m);
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

// Remove a profile from the current group. The person stays in the
// database. Like adding, this takes effect in storage when the group
// is saved.
function removeFromProfileList(profile) {
  profileList = profileList.filter(entry => entry !== profile);
  buildAncestorGroups();
}

let profileBeingFetched;

function treeBuildingResult(person) {
  return (client.stopped ? 'Stopped' : 'Finished') + ' tree building for '
    + person.name();
}

async function addProfile() {
  if (addProfileElement.value.trim() === '') {
    return;
  }
  // Pressing the Add button can trigger both a change and a click event,
  // so ignore a second add of the profile being added.
  const guid = isolateId(addProfileElement.value.trim());
  if (guid === profileBeingFetched) {
    console.log('addProfile called twice on', guid, ', ignoring');
    return;
  }
  profileBeingFetched = guid;
  startTreeBuild();
  try {
    if (!client.connected) {
      await connectToGeni();
    }
    addProfileMessage.innerText = 'Fetching id ' + guid;
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
          console.log('Building tree for added person', stored.name());
          addProfileMessage.innerText = 'Building tree for ' + stored.name();
          await buildTreeForPerson(stored, 2025, Number(yearLimitElement.value));
          buildAncestorGroups();
          addProfileMessage.innerText = treeBuildingResult(stored);
          return;
        }
        addProfileMessage.innerText = stored.name() + ' is already in the group';
        return;
      }
      console.log('Following merged-to pointer', mergedTo);
      fetched = await client.getPersonByUrl(mergedTo);
    } else {
      console.log('Adding profile ', guid);
      fetched = await fetchProfile(guid);
    }
    fetched = await followMerges(fetched);
    if (!('guid' in fetched)) {
      console.log('No guid, no profile?');
      addProfileMessage.innerText = 'Add did not find a profile';
      return;
    }
    const person = storeProfile(fetched, stored?.id());
    addNameToProfileList(person);
    addProfileElement.value = '';
    console.log('Building tree for added person', person.name());
    addProfileMessage.innerText = 'Building tree for ' + person.name();
    await buildTreeForPerson(person, 2025, Number(yearLimitElement.value));
    buildAncestorGroups();
    addProfileMessage.innerText = treeBuildingResult(person);
  } catch (error) {
    console.log('Add failed, message ', error);
    addProfileMessage.innerText = 'Add failed, error '
      + (error?.message ?? JSON.stringify(error));
    return;
  } finally {
    profileBeingFetched = undefined;
    finishTreeBuild();
  }
}

// Some assumptions about Geni's answers have not been checked yet. If one
// turns out to be wrong, show it on the page and stop fetching, so that
// it can be looked into before more of the database is changed.
function reportSurprise(kind, details, answer) {
  console.log('Unexpected Geni answer:', kind, details, answer);
  showErrorMessage('Unexpected Geni answer: ' + kind + ' (' + details
                   + '). Fetching stopped; see the console for more.');
  client.stop();
}

// Profiles merged on Geni are answered with a merged_into pointer to the
// profile they were merged into, which may itself have been merged.
const maxMergeSteps = 5;

// Follow merged_into pointers from a fetched profile to the current one.
async function followMerges(profile) {
  const first = profile;
  for (let i = 0; i < maxMergeSteps && 'merged_into' in profile; i++) {
    console.log('Following merged-to pointer', profile.merged_into);
    if (typeof profile.merged_into !== 'string'
        || !profile.merged_into.startsWith(idToUrl(''))) {
      reportSurprise('merged_into is not a profile API URL',
                     String(profile.merged_into), profile);
      return profile;
    }
    profile = await client.getPersonByUrl(profile.merged_into);
  }
  if ('merged_into' in profile) {
    reportSurprise(`more than ${maxMergeSteps} merges in a row`,
                   String(first.guid ?? first.id), first);
  } else if (profile !== first && !('guid' in profile)) {
    reportSurprise('the profile merged into has no guid',
                   String(first.merged_into), profile);
  }
  return profile;
}

// Fetch a profile by guid, following merges.
async function fetchProfile(guid) {
  const profile = await client.getPerson(guid);
  if ('guid' in profile && profile.guid !== guid
      && !('merged_into' in profile)) {
    // Treated as a merge, but Geni was expected to say merged_into.
    reportSurprise('asked for one guid, got another without merged_into',
                   `Asked for ${guid}, got ${profile.guid}`);
  }
  return followMerges(profile);
}

// Add a fetched profile to the database, unless it is there already.
// If it was fetched for the person oldId and has another guid, oldId was
// merged into it: record the merge, which moves the links to it.
// Returns the person.
function storeProfile(profile, oldId) {
  const person = db.get(profile.guid)
        ?? db.addWithAttributes(profile.guid, profile);
  if (oldId !== undefined && oldId !== profile.guid) {
    const changed = db.merge(oldId, profile.guid);
    console.log(oldId, 'was merged into', person.name(), '- changed links of',
                changed, 'persons');
    followMergesInProfileList();
  }
  return person;
}

// Replace persons in the profile list that have been merged into others.
function followMergesInProfileList() {
  const seen = new Set();
  profileList = profileList.map(entry => db.get(entry.id()) ?? entry)
    .filter(entry => !seen.has(entry) && seen.add(entry));
}

// Fetch a profile by guid, following merges. Returns the person,
// or undefined if no profile was found.
async function fetchPersonByGuid(guid) {
  const profile = await fetchProfile(guid);
  if (!('guid' in profile)) {
    console.log('No profile found for', guid);
    return undefined;
  }
  return storeProfile(profile, guid);
}

async function addProfileByUrl(url) {
  try {
    console.log('Adding profile ', url);
    const fetched = await followMerges(await client.getPersonByUrl(url));
    if (!('guid' in fetched)) {
      console.log('No guid, no profile?');
      return;
    }
    const person = storeProfile(fetched);
    console.log('Added', person.name());
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

// Number of tree builds running, from the Build tree or the Add button.
// The Build tree button is disabled while any is running.
let treeBuildsRunning = 0;

function startTreeBuild() {
  treeBuildsRunning++;
  buildTreeButton.disabled = true;
  client.start();
}

function finishTreeBuild() {
  treeBuildsRunning--;
  if (treeBuildsRunning === 0) {
    buildTreeButton.disabled = false;
  }
}

// Fetch the ancestors of person born in yearLimit or later. If
// generations is given, stop after that many generations as well.
async function buildTreeForPerson(person, birthYearAssumption, yearLimit,
                                  generations = Infinity) {
  if (client.stopped || generations <= 0) {
    return;
  }
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
  if (person.parents === undefined) {
    await addParents(person);
  }
  if (person.parents === undefined) {
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
      dbFather = await fetchPersonByGuid(person.father());
    }
    await buildTreeForPerson(dbFather, birthYear - 30, yearLimit,
                             generations - 1);
  }
  if (person.mother()) {
    let dbMother = db.get(person.mother());
    if (!dbMother) {
      // somehow ref to mother got stored, but not mother
      dbMother = await fetchPersonByGuid(person.mother());
    }
    await buildTreeForPerson(dbMother, birthYear - 30, yearLimit,
                             generations - 1);
  }
}

async function buildTree(yearLimit) {
  await connectToGeni();
  for (const person of profileList) {
    if (client.stopped) {
      console.log('Tree build stopped');
      break;
    }
    console.log('Starting tree for root person', person.name());
    await buildTreeForPerson(person, 2025, yearLimit);
  }
  console.log('Tree build finished, computing ancestor groups');
  buildAncestorGroups();
}

// Ancestors with fewer known ancestors than this get a link in the
// group list for fetching more of them.
const fewAncestors = 4;
const extraGenerations = 2;

// Fetch extraGenerations of ancestors for person, regardless of the
// "back to" year limit, and recalculate the groups.
async function fetchMoreAncestors(person) {
  startTreeBuild();
  try {
    if (!client.connected) {
      await connectToGeni();
    }
    addProfileMessage.innerText = 'Fetching ancestors of ' + person.name();
    await buildTreeForPerson(person, 2025, -Infinity, extraGenerations);
    buildAncestorGroups();
    addProfileMessage.innerText = treeBuildingResult(person);
  } catch (error) {
    console.log('Fetching ancestors failed, message ', error);
    addProfileMessage.innerText = 'Fetching ancestors failed, error '
      + (error?.message ?? JSON.stringify(error));
  } finally {
    finishTreeBuild();
  }
}

// Fetch person and all ancestors back to the "back to" year limit again,
// to pick up changes and new parents on Geni, and recalculate the groups.
async function rebuildTree(person) {
  startTreeBuild();
  try {
    if (!client.connected) {
      await connectToGeni();
    }
    addProfileMessage.innerText = 'Rebuilding tree for ' + person.name();
    await rebuildTreeForPerson(person, 2025, Number(yearLimitElement.value),
                               new Set(), new Set());
    buildAncestorGroups();
    addProfileMessage.innerText = (client.stopped ? 'Stopped' : 'Finished')
      + ' rebuilding tree for ' + person.name();
  } catch (error) {
    console.log('Rebuilding tree failed, message ', error);
    addProfileMessage.innerText = 'Rebuilding tree failed, error '
      + (error?.message ?? JSON.stringify(error));
  } finally {
    finishTreeBuild();
  }
}

// Like buildTreeForPerson, but fetches every profile and its parents
// again, even if they are already in the database. visited holds the
// guids of the persons handled in this rebuild, so that an ancestor
// reached by several paths is only handled once; fetched those whose
// profiles were fetched in this rebuild (see refreshPerson).
async function rebuildTreeForPerson(person, birthYearAssumption, yearLimit,
                                    visited, fetched) {
  if (client.stopped || visited.has(person.id())) {
    return;
  }
  visited.add(person.id());
  const birthYear = person.birth() ?? birthYearAssumption;
  if (birthYear < yearLimit) {
    return;
  }
  person = await refreshPerson(person, fetched);
  visited.add(person.id());
  for (const parentId of [person.father(), person.mother()]) {
    const parent = parentId && db.get(parentId);
    if (parent) {
      await rebuildTreeForPerson(parent, birthYear - 30, yearLimit,
                                 visited, fetched);
    }
  }
}

// Fetch person's profile and parents from Geni again, and set the parent
// links from the answer. If a fetch fails, the stored data is kept.
// If the profile was merged into another, the merge is recorded and the
// other person is refreshed instead. Returns the person refreshed.
// fetched holds the guids of profiles already fetched in this rebuild,
// which are not fetched again; guids fetched here are added to it.
async function refreshPerson(person, fetched) {
  if (!fetched.has(person.id())) {
    let profile;
    try {
      profile = await fetchProfile(person.id());
    } catch (error) {
      console.log('Refetching', person.name(), 'failed, message', error);
      return person;
    }
    if (!('guid' in profile)) {
      console.log(person.name(), 'not found, keeping it');
      return person;
    }
    if (profile.guid !== person.id()) {
      person = storeProfile(profile, person.id());
      if (fetched.has(person.id())) {
        // Already refreshed in this rebuild.
        return person;
      }
    }
    db.updateAttributes(person.id(), profile);
    fetched.add(person.id());
  }
  const oldParents = person.parents;
  const oldFather = person.father();
  const oldMother = person.mother();
  person.parents = undefined;
  if (person.unions()) {
    await addParents(person);
  } else {
    // Without unions, Geni knows no parents. But every ancestor is in a
    // union with a partner, so this was not expected in a tree.
    reportSurprise('a profile in a tree has no unions',
                   `${person.name()} (${person.id()})`);
    person.parents = [];
  }
  if (person.parents === undefined) {
    person.parents = oldParents;
    person.setFather(oldFather);
    person.setMother(oldMother);
    return person;
  }
  let father;
  let mother;
  let failed = false;
  for (const parentUrl of person.parents) {
    let parent = db.getByIdAttribute(urlToId(parentUrl));
    if (!parent) {
      parent = await addProfileByUrl(parentUrl);
      if (parent) {
        fetched.add(parent.id());
      }
    }
    if (!parent) {
      console.log('Unable to fetch', parentUrl);
      failed = true;
    } else if (parent.gender() == 'male') {
      if (father) {
        reportSurprise('two fathers', `${person.name()} (${person.id()})`);
      }
      father = parent.id();
    } else {
      if (mother) {
        reportSurprise('two mothers, or a parent with unknown gender',
                       `${person.name()} (${person.id()})`);
      }
      mother = parent.id();
    }
  }
  if (!failed && ((oldFather && !father) || (oldMother && !mother))) {
    // Parents can be removed on Geni, but this may also mean that
    // resolveParents missed them.
    reportSurprise('known parents were not found again',
                   `${person.name()} (${person.id()})`);
  }
  // If a parent could not be fetched, keep the old link in its place.
  person.setFather(father ?? (failed ? oldFather : undefined));
  person.setMother(mother ?? (failed ? oldMother : undefined));
  return person;
}

// The ancestor count of person in [], as a link that fetches more
// ancestors if there are few.
function ancestorCount(person) {
  const count = person.ancestors().size;
  if (count >= fewAncestors) {
    return document.createTextNode(`[${count}]`);
  }
  const span = document.createElement('span');
  const link = document.createElement('a');
  link.href = '#';
  link.title = `Fetch ${extraGenerations} generations of ancestors`;
  link.textContent = count;
  link.addEventListener('click', event => {
    event.preventDefault();
    fetchMoreAncestors(person);
  });
  span.append('[', link, ']');
  return span;
}

// Grouping algorithm menu ==========================================

// Menu text for each of groupingAlgorithms.
const algorithmLabels = {
  sharedAncestors: 'Most shared ancestors',
  kinship: 'Kinship (closer ancestors count more)',
  closestAncestor: 'Closest common ancestor',
  rootDescendants: 'Root ancestor with most descendants'
};
// The ones that merge the most complete trees first have the label of
// the same scoring with this added.
const completenessSuffix = 'Completeness';
const completenessLabel = ' + consider completeness';

function algorithmLabel(name) {
  if (name.endsWith(completenessSuffix)) {
    const base = name.slice(0, -completenessSuffix.length);
    if (Object.hasOwn(algorithmLabels, base)) {
      return algorithmLabels[base] + completenessLabel;
    }
  }
  return algorithmLabels[name] ?? name;
}
// The chosen algorithm is remembered in localStorage under this key.
const algorithmKey = 'groupingAlgorithm';

function displayAlgorithmSelect() {
  for (const name of Object.keys(groupingAlgorithms)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = algorithmLabel(name);
    algorithmSelectElement.append(option);
  }
  const stored = localStorage.getItem(algorithmKey);
  algorithmSelectElement.value =
    Object.hasOwn(groupingAlgorithms, stored) ? stored : 'sharedAncestors';
}

function buildAncestorGroups() {
  db.createAncestors();
  ancestorGroups = groupingAlgorithms[algorithmSelectElement.value](
    profileList, db);
  console.log('Ancestor groups are', ancestorGroups);
  displayProfileList();
  displayAncestorGroups();
}

function displayAncestorGroups() {
  const dl = document.createElement('dl');

  // People who share no ancestors with anyone are left out.
  ancestorGroups.filter(item => item.persons.length > 1).forEach(item => {
    const dt = document.createElement('dt');
    const personArray = item.persons.map(person => person.name());
    personArray.forEach(personName => {
      dt.appendChild(document.createTextNode(personName));
      dt.appendChild(document.createElement('br'));
    });
    const dd = document.createElement('dd');
    const significantAncestors = removeInnerParents(db, item.ancestors);
    significantAncestors.forEach(ancestor => {
      dd.appendChild(profileLink(ancestor));
      dd.appendChild(document.createTextNode(
        ' (' + ancestor.birth() + ') '));
      dd.appendChild(ancestorCount(ancestor));
      dd.appendChild(document.createElement('br'));
    });

    dl.appendChild(dt);
    dl.appendChild(dd);
  });

  groupListElement.innerHTML = '';
  groupListElement.appendChild(dl);
}

// Export and import of database and groups to a file ==============

// Offer a JSON string to the user as a file download.
function downloadJson(json, fileName) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function exportToFile() {
  const exported = exportToJsonString(db, groupStore, currentGroup,
                                      currentProfileIds());
  downloadJson(exported, 'acac-' + today() + '.json');
}

function saveGroupToFile() {
  const exported = exportGroupToJsonString(currentGroup, currentProfileIds(),
                                           db);
  const groupName = currentGroup === '' ? 'unnamed' : currentGroup;
  downloadJson(exported, 'acac-group-' + groupName + '-' + today() + '.json');
}

// Merge the persons in a group file into the database, and make the
// group in the file the current group.
async function loadGroupFromFile(file) {
  let imported;
  try {
    imported = parseGroupExport(await file.text());
  } catch (error) {
    showErrorMessage('Could not load ' + file.name + ': ' + error.message);
    return;
  }
  const groupName = imported.groupName;
  if ((groupStore.has(groupName) || groupName === currentGroup)
      && !confirm('Replace the members of group "' + groupName
                  + '" with those in ' + file.name + '?')) {
    return;
  }
  const result = mergeGroupImport(imported, db);
  await saveDatabase(db);
  groupStore.switchTo(currentGroup, currentProfileIds(), groupName);
  groupStore.save(groupName, result.ids);
  selectGroup(groupName);
  buildAncestorGroups();
  groupFileMessage.innerText = `Loaded ${imported.persons.length} profiles `
    + `(${result.ids.length} members and their ancestors): `
    + `${result.added} new, ${result.replaced} updated from the file, `
    + `${result.kept} kept as in the database`;
}

async function importFromFile(file) {
  let imported;
  try {
    imported = parseExport(await file.text());
  } catch (error) {
    showErrorMessage('Could not load ' + file.name + ': ' + error.message);
    return;
  }
  if (!confirm('Replace the current database and all groups with the '
               + 'contents of ' + file.name + '?')) {
    return;
  }
  const importedGroup = applyImport(imported, db, groupStore);
  await saveDatabase(db);
  selectGroup(importedGroup);
  buildAncestorGroups();
}

// Binding actions to buttons ======================================

groupSelectElement.addEventListener('change', async () => {
  if (groupSelectElement.selectedOptions[0] === newGroupOption) {
    newGroupNameElement.value = '';
    newGroupBox.hidden = false;
    newGroupNameElement.focus();
  } else {
    await switchToGroup(groupSelectElement.value);
  }
});

newGroupCreateButton.addEventListener('click', () => {
  createNewGroup();
});

newGroupNameElement.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    createNewGroup();
  } else if (event.key === 'Escape') {
    cancelNewGroup();
  }
});

newGroupCancelButton.addEventListener('click', () => {
  cancelNewGroup();
});

saveGroupButton.addEventListener('click', () => {
  saveGroupToFile();
});

loadGroupButton.addEventListener('click', () => {
  loadGroupInput.click();
});

loadGroupInput.addEventListener('change', async () => {
  const file = loadGroupInput.files[0];
  // Reset so that choosing the same file again triggers a new change event.
  loadGroupInput.value = '';
  if (file) {
    await loadGroupFromFile(file);
  }
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
  await saveCurrentState();
});

exportFileButton.addEventListener('click', () => {
  exportToFile();
});

importFileButton.addEventListener('click', () => {
  importFileInput.click();
});

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files[0];
  // Reset so that choosing the same file again triggers a new change event.
  importFileInput.value = '';
  if (file) {
    await importFromFile(file);
  }
});

buildTreeButton.addEventListener('click', async () => {
  startTreeBuild();
  try {
    await buildTree(Number(yearLimitElement.value));
  } finally {
    finishTreeBuild();
  }
});

stopFetchingButton.addEventListener('click', () => {
  client.stop();
});

recalculateGroupsButton.addEventListener('click', () => {
  buildAncestorGroups();
});

algorithmSelectElement.addEventListener('change', () => {
  localStorage.setItem(algorithmKey, algorithmSelectElement.value);
  buildAncestorGroups();
});

// ===== Initialize the page from last saved state ====
await loadDatabase(db);
console.log('Database size', db.size());
displayAlgorithmSelect();
selectGroup(groupStore.currentName());
buildAncestorGroups();
