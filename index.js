import { Person, Database } from './database.js';
import { GeniClient } from './async_geni.js';
import { isolateId } from './geni_structures.js';
import { loadDatabase, saveDatabase } from './opfsdb.js';
import { GroupStore } from './groups.js';
import {
  exportToJsonString,
  parseExport,
  applyImport,
  exportGroupToJsonString,
  parseGroupExport,
  mergeGroupImport,
} from './file_export.js';
import { groupingAlgorithms } from './ancestor_finder.js';
import * as display from './display_functions.js';
import { TreeBuilder } from './tree_builder.js';

let db = new Database();
let lastDatabaseSize = 0;
let profileAdditionCount = 0;
let savedProfileAdditionCount = 0;
const cacheSizeElement = document.getElementById('cache-size');
db.sizeView = (number) => {
  cacheSizeElement.innerText = number;
  if (number > lastDatabaseSize) {
    profileAdditionCount += number - lastDatabaseSize;
  }
  lastDatabaseSize = number;
};

async function saveDatabaseSnapshot() {
  const additionsAtStart = profileAdditionCount;
  await saveDatabase(db);
  savedProfileAdditionCount = additionsAtStart;
}

const errorMessageElement = document.getElementById('error-message');

// True if the error message shown tells of a lasting state (install
// error, login status) rather than the outcome of an operation.
let errorMessageLasting = false;

function showErrorMessage(message, lasting = false) {
  errorMessageElement.innerText = message;
  errorMessageElement.hidden = false;
  errorMessageLasting = lasting;
}

function hideErrorMessage() {
  errorMessageElement.hidden = true;
}

// Called when the user asks for a new operation: the error message
// from an earlier one no longer applies.
function startUserOperation() {
  if (!errorMessageLasting) {
    hideErrorMessage();
  }
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
      showErrorMessage('Install error: Geni API key missing', true);
    }
  } else {
    console.log('Fetching Geni API key failed');
    showErrorMessage('Install error: Geni API key missing', true);
  }
} catch (err) {
  console.log('Fetching Geni API threw, error ', err);
  showErrorMessage('Install error: Geni API key missing', true);
}
// Don't hide an install error behind the login status.
if (errorMessageElement.hidden) {
  showErrorMessage('Not logged in', true);
}

const client = new GeniClient(geniAppId);
client.onCallbackError = (error, operation) => {
  reportSurprise(
    'Geni callback error',
    operation + ': ' + (error?.message ?? String(error)),
    error,
  );
};
let currentQueueSize = 0;
client.queueSizeView = (number, waiting) => {
  const wasBusy = currentQueueSize > 0;
  currentQueueSize = number;
  scheduleRunningCounts();
  if (number === 0) {
    queueSizeElement.innerText = 'Queue empty';
  } else {
    queueSizeElement.innerText =
      'Queue size: ' + number + (waiting ? ' waiting' : '');
  }
  if (wasBusy && number === 0) {
    // Let the request's promise handlers store any returned profiles first.
    setTimeout(() => {
      if (
        currentQueueSize === 0 &&
        profileAdditionCount > savedProfileAdditionCount
      ) {
        saveDatabaseSnapshot().catch((error) => {
          console.log('Automatic database save failed', error);
          showErrorMessage(
            'Automatic database save failed: ' +
              (error?.message ?? String(error)),
          );
        });
      }
    }, 0);
  }
};

// Connect to Geni, keeping the error message in sync with login status.
async function connectToGeni() {
  try {
    await client.connect();
    hideErrorMessage();
  } catch (error) {
    showErrorMessage('Login failed', true);
    throw error;
  }
}

let profileList = [];
let ancestorGroups = [];
// Ids of the profiles in the current group excluded from matching by
// the user. They are left out when the groups are computed.
let excludedProfileIds = new Set();
// Ids of the profiles that were alone in their group when the groups
// were last computed. They are marked in the profile list. Profiles
// added since then are not, as they have not been grouped yet.
let ungroupedProfileIds = new Set();

// Get UI elements from HTML file.
const groupSelectElement = document.getElementById('group-select');
const groupNotesElement = document.getElementById('group-notes');
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
const pathAgeLimitElement = document.getElementById('path-age-limit');
const pathLengthLimitElement = document.getElementById('path-length-limit');
const recalculateGroupsButton = document.getElementById('recalculate-groups');
const groupListElement = document.getElementById('group-list');
const algorithmSelectElement = document.getElementById('algorithm-select');
const initialsOnlyElement = document.getElementById('initials-only');

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
  groupStore.names(currentGroup).forEach((name) => {
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
  groupNotesElement.value = groupStore.notes(name);
  loadProfileList();
}

// Leave the "New group..." state without reloading the current group,
// so that unsaved profiles are kept.
function cancelNewGroup() {
  newGroupBox.hidden = true;
  groupSelectElement.value = currentGroup;
}

function currentProfileIds() {
  return profileList.map((p) => p.id());
}

// The ids of the current group's members excluded from matching.
function currentExcludedIds() {
  return currentProfileIds().filter((id) => excludedProfileIds.has(id));
}

// Save the database and the current group, same as the "Save database" button.
async function saveCurrentState() {
  await saveDatabaseSnapshot();
  groupStore.save(currentGroup, currentProfileIds());
  groupStore.saveNotes(currentGroup, groupNotesElement.value);
  groupStore.saveExcluded(currentGroup, currentExcludedIds());
  groupStore.setCurrentName(currentGroup);
}

// Save the database and the current group, then switch to another group
// and recalculate its ancestor groups.
async function switchToGroup(name) {
  await saveDatabaseSnapshot();
  groupStore.switchTo(
    currentGroup,
    currentProfileIds(),
    name,
    currentExcludedIds(),
  );
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
  profileList = groupStore
    .entries(currentGroup)
    .map((entry) => {
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
    })
    .filter((profile) => profile);
  excludedProfileIds = new Set(
    groupStore.excluded(currentGroup).map((id) => db.currentId(id)),
  );
  displayProfileList();
}

// The "Show initials only" setting is remembered in localStorage under
// this key.
const initialsOnlyKey = 'initialsOnly';

// The name of person as shown on the page (see display.displayName).
function displayName(person) {
  return display.displayName(
    person,
    initialsOnlyElement.checked,
    new Set(currentProfileIds()),
  );
}

// Returns a link that opens the person's Geni profile in a new tab.
function profileLink(person) {
  const link = document.createElement('a');
  link.href =
    person.attribute('profile_url') ||
    'https://www.geni.com/people/profile/' + person.guid();
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = displayName(person);
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
  const findPaths = document.createElement('option');
  findPaths.value = 'find-paths';
  findPaths.textContent = 'Find paths to other profiles';
  const exclude = document.createElement('option');
  exclude.value = 'exclude';
  exclude.textContent = excludedProfileIds.has(profile.id())
    ? 'Include in matching'
    : 'Exclude from matching';
  select.append(title, remove, rebuild, findPaths, exclude);
  select.addEventListener('change', () => {
    if (select.value !== '') {
      startUserOperation();
    }
    if (select.value === 'remove') {
      removeFromProfileList(profile);
    } else if (select.value === 'rebuild') {
      rebuildTree(profile);
    } else if (select.value === 'find-paths') {
      findPathsToGroup(profile);
    } else if (select.value === 'exclude') {
      toggleExcluded(profile);
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

// The ancestor ids last shown for each profile in the list, by guid.
// Fetching should only add ancestors, so a shown count going down is
// reported as a surprise, to find out why it happens. Merges and
// parents removed on Geni can lower it too, but rarely.
const shownAncestors = new Map();

// Show the ancestor count of profile in cell. source says which code
// worked out the ancestors, for the report.
function showAncestorCount(profile, cell, ancestors, source) {
  cell.textContent = ancestors.size;
  const previous = shownAncestors.get(profile.id());
  shownAncestors.set(profile.id(), ancestors);
  const drop = display.ancestorCountDrop(previous, ancestors, profile.id(), db);
  if (!drop) {
    return;
  }
  const describe = (id) => `${db.get(id)?.name()} (${id})`;
  reportSurprise(
    'ancestor count went down',
    `${displayName(profile)} (${profile.id()}): ` +
      `${previous.size} to ` +
      `${ancestors.size}, in ${source}`,
    {
      lost: drop.lost.map(describe),
      suspects: drop.suspects.map(describe),
      treeBuildsRunning,
    },
  );
}

// Update the ancestor counts and completeness indexes in the profile
// list without redrawing it.
function displayRunningCounts() {
  ancestorCountCells.forEach((cell, profile) => {
    showAncestorCount(
      profile,
      cell,
      db.ancestorIds(profile.id()),
      'running counts',
    );
  });
  const memo = new Map();
  completenessCells.forEach((cell, profile) => {
    cell.textContent = display.formatCompleteness(
      db.completenessIndex(profile.id(), memo),
    );
  });
}

// The column the profile list is sorted on (see display.sortProfiles),
// or undefined for the order added. Only the display is sorted;
// profileList keeps its order.
let profileSortColumn;
let profileSortReversed = false;

function sortProfileList(column) {
  ({ column: profileSortColumn, reversed: profileSortReversed } =
    display.nextSortState(column, profileSortColumn, profileSortReversed));
  displayProfileList();
}

// A column heading that sorts the list on column when clicked.
function sortHeading(text, column) {
  const th = document.createElement('th');
  const link = document.createElement('a');
  link.href = '#';
  link.textContent =
    text +
    display.sortIndicator(column, profileSortColumn, profileSortReversed);
  link.title = 'Sort on this column; click again to reverse';
  link.addEventListener('click', (event) => {
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
  th.append(
    sortHeading('Name', 'name'),
    ancestorsHeading,
    sortHeading('Generations', 'generations'),
    document.createElement('th'),
  );
  table.append(th);

  // The generations are worked out from the parent links, like the
  // running counts, so that they match the sort order.
  const memo = new Map();
  display
    .sortProfiles(profileList, profileSortColumn, profileSortReversed, db)
    .forEach((profile) => {
      const row = document.createElement('tr');
      const rowClass = display.profileRowClass(
        profile.id(),
        excludedProfileIds,
        ungroupedProfileIds,
      );
      if (rowClass) {
        row.classList.add(rowClass);
      }
      const n = document.createElement('td');
      n.append(profileLink(profile));
      row.append(n);
      const a = document.createElement('td');
      // From the parent links, like the running counts: the ancestor sets
      // are only built when fetching is finished, so during a fetch they
      // would show older, lower counts.
      showAncestorCount(
        profile,
        a,
        db.ancestorIds(profile.id()),
        'profile list',
      );
      ancestorCountCells.set(profile, a);
      row.append(a);
      const c = document.createElement('td');
      c.textContent = display.formatCompleteness(
        db.completenessIndex(profile.id(), memo),
      );
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
  if (profileList.find((entry) => entry.guid() == person.guid())) {
    console.log('Profile already in list');
    return false;
  } else {
    profileList.push(person);
    displayProfileList();
    return true;
  }
}

// Exclude a profile from matching, or include it again, and recompute
// the groups. Like adding, this takes effect in storage when the group
// is saved.
function toggleExcluded(profile) {
  if (!excludedProfileIds.delete(profile.id())) {
    excludedProfileIds.add(profile.id());
  }
  buildAncestorGroups();
}

// Remove a profile from the current group. The person stays in the
// database. Like adding, this takes effect in storage when the group
// is saved.
function removeFromProfileList(profile) {
  profileList = profileList.filter((entry) => entry !== profile);
  excludedProfileIds.delete(profile.id());
  buildAncestorGroups();
}

let profileBeingFetched;

function treeBuildingResult(person) {
  return display.treeBuildingResult(displayName(person), client.stopped);
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
    const person = await treeBuilder.fetchProfileToAdd(guid);
    if (!person) {
      addProfileMessage.innerText = 'Add did not find a profile';
      return;
    }
    if (!addNameToProfileList(person)) {
      addProfileMessage.innerText =
        displayName(person) + ' is already in the group';
      return;
    }
    addProfileElement.value = '';
    console.log('Building tree for added person', person.name());
    addProfileMessage.innerText = 'Building tree for ' + displayName(person);
    await treeBuilder.buildTreeForPerson(
      person,
      2025,
      Number(yearLimitElement.value),
    );
    buildAncestorGroups();
    addProfileMessage.innerText = treeBuildingResult(person);
  } catch (error) {
    console.log('Add failed, message ', error);
    addProfileMessage.innerText =
      'Add failed, error ' + (error?.message ?? JSON.stringify(error));
    return;
  } finally {
    profileBeingFetched = undefined;
    finishTreeBuild();
  }
}

// An answer from Geni did not match what the code expects (see
// TreeBuilder): show it on the page. Fetching is stopped.
function showSurprise(kind, details) {
  showErrorMessage(
    'Unexpected Geni answer: ' +
      kind +
      ' (' +
      details +
      '). Fetching stopped; see the console for more.',
  );
}

// Show an unexpected finding of the page's own, and stop fetching.
function reportSurprise(kind, details, answer) {
  console.log('Unexpected Geni answer:', kind, details, answer);
  showSurprise(kind, details);
  client.stop();
}

// Replace persons in the profile list that have been merged into others.
function followMergesInProfileList() {
  const seen = new Set();
  profileList = profileList
    .map((entry) => db.get(entry.id()) ?? entry)
    .filter((entry) => !seen.has(entry) && seen.add(entry));
  excludedProfileIds = new Set(
    excludedProfileIds.values().map((id) => db.currentId(id)),
  );
}

const treeBuilder = new TreeBuilder(client, db, {
  onSurprise: showSurprise,
  onMerge: followMergesInProfileList,
  onMessage: (text) => {
    addProfileMessage.innerText = text;
  },
  name: displayName,
});

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

async function buildTree(yearLimit) {
  await connectToGeni();
  for (const person of profileList) {
    if (client.stopped) {
      console.log('Tree build stopped');
      break;
    }
    console.log('Starting tree for root person', person.name());
    await treeBuilder.buildTreeForPerson(person, 2025, yearLimit);
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
    addProfileMessage.innerText =
      'Fetching ancestors of ' + displayName(person);
    await treeBuilder.buildTreeForPerson(
      person,
      2025,
      -Infinity,
      extraGenerations,
    );
    buildAncestorGroups();
    addProfileMessage.innerText = treeBuildingResult(person);
  } catch (error) {
    console.log('Fetching ancestors failed, message ', error);
    addProfileMessage.innerText =
      'Fetching ancestors failed, error ' +
      (error?.message ?? JSON.stringify(error));
  } finally {
    finishTreeBuild();
  }
}

// Fetch person and all ancestors back to the "back to" year limit again,
// to pick up changes and new parents on Geni, and recalculate the groups.
// If other rebuilds are running, this waits until they are all done.
async function rebuildTree(person) {
  startTreeBuild();
  try {
    if (!client.connected) {
      await connectToGeni();
    }
    addProfileMessage.innerText = 'Rebuilding tree for ' + displayName(person);
    await treeBuilder.rebuild(person, Number(yearLimitElement.value));
    buildAncestorGroups();
    addProfileMessage.innerText =
      (client.stopped ? 'Stopped' : 'Finished') +
      ' rebuilding tree for ' +
      displayName(person);
  } catch (error) {
    console.log('Rebuilding tree failed, message ', error);
    addProfileMessage.innerText =
      'Rebuilding tree failed, error ' +
      (error?.message ?? JSON.stringify(error));
  } finally {
    finishTreeBuild();
  }
}

// Find the blood path from person to every other group member, adding
// profiles from each completed path to the cached tree within the limits.
async function findPathsToGroup(person) {
  startTreeBuild();
  try {
    if (!client.connected) {
      await connectToGeni();
    }
    const pathLengthLimit = Number(pathLengthLimitElement.value);
    const pathAgeLimit = Number(pathAgeLimitElement.value);
    const others = profileList.filter((other) => other.id() !== person.id());
    const pathResult = await treeBuilder.findPathsToProfiles(
      person,
      others,
      pathLengthLimit,
      pathAgeLimit,
      (other) => {
        addProfileMessage.innerText =
          'Finding path from ' +
          displayName(person) +
          ' to ' +
          displayName(other);
      },
    );
    followMergesInProfileList();
    buildAncestorGroups();
    addProfileMessage.innerText =
      (client.stopped ? 'Stopped' : 'Finished') +
      ' finding paths from ' +
      displayName(db.get(person.id()) ?? person) +
      '. Path statuses: done ' +
      pathResult.statusCounts.done +
      ', pending ' +
      pathResult.statusCounts.pending +
      ', overloaded ' +
      pathResult.statusCounts.overloaded +
      ', not found ' +
      pathResult.statusCounts['not found'] +
      ', other ' +
      pathResult.statusCounts.other +
      '; added ' +
      pathResult.added +
      ' new profiles' +
      '; discarded ' +
      pathResult.pathsDiscarded +
      ' paths over ' +
      pathLengthLimit +
      ' steps and ' +
      pathResult.profilesDiscarded.length +
      ' profiles born before ' +
      pathAgeLimit;
  } catch (error) {
    console.log('Finding paths failed, message ', error);
    addProfileMessage.innerText =
      'Finding paths failed, error ' +
      (error?.message ?? JSON.stringify(error));
  } finally {
    finishTreeBuild();
  }
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
  link.addEventListener('click', (event) => {
    event.preventDefault();
    startUserOperation();
    fetchMoreAncestors(person);
  });
  span.append('[', link, ']');
  return span;
}

// Grouping algorithm menu ==========================================

// The chosen algorithm is remembered in localStorage under this key.
const algorithmKey = 'groupingAlgorithm';

function displayAlgorithmSelect() {
  for (const name of Object.keys(groupingAlgorithms)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = display.algorithmLabel(name);
    algorithmSelectElement.append(option);
  }
  const stored = localStorage.getItem(algorithmKey);
  algorithmSelectElement.value = Object.hasOwn(groupingAlgorithms, stored)
    ? stored
    : 'sharedAncestors';
}

function buildAncestorGroups() {
  db.createAncestors();
  ancestorGroups = groupingAlgorithms[algorithmSelectElement.value](
    profileList.filter((profile) => !excludedProfileIds.has(profile.id())),
    db,
  );
  console.log('Ancestor groups are', ancestorGroups);
  ungroupedProfileIds = display.ungroupedIds(ancestorGroups);
  displayProfileList();
  displayAncestorGroups();
}

function displayAncestorGroups() {
  const dl = document.createElement('dl');

  display.groupListEntries(ancestorGroups, db).forEach((entry) => {
    const dt = document.createElement('dt');
    entry.members.forEach((member) => {
      dt.appendChild(document.createTextNode(displayName(member)));
      dt.appendChild(document.createElement('br'));
    });
    const dd = document.createElement('dd');
    entry.ancestors.forEach((ancestor) => {
      dd.appendChild(profileLink(ancestor));
      dd.appendChild(document.createTextNode(' (' + ancestor.birth() + ') '));
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

function exportToFile() {
  const exported = exportToJsonString(
    db,
    groupStore,
    currentGroup,
    currentProfileIds(),
    currentExcludedIds(),
  );
  downloadJson(exported, display.databaseFileName(new Date()));
}

function saveGroupToFile() {
  const exported = exportGroupToJsonString(
    currentGroup,
    currentProfileIds(),
    db,
    currentExcludedIds(),
    groupNotesElement.value,
  );
  downloadJson(exported, display.groupFileName(currentGroup, new Date()));
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
  if (
    (groupStore.has(groupName) || groupName === currentGroup) &&
    !confirm(
      'Replace the members of group "' +
        groupName +
        '" with those in ' +
        file.name +
        '?',
    )
  ) {
    return;
  }
  const result = mergeGroupImport(imported, db);
  await saveDatabaseSnapshot();
  groupStore.switchTo(
    currentGroup,
    currentProfileIds(),
    groupName,
    currentExcludedIds(),
  );
  groupStore.save(groupName, result.ids);
  groupStore.saveNotes(groupName, imported.notes ?? '');
  groupStore.saveExcluded(groupName, result.excluded);
  selectGroup(groupName);
  buildAncestorGroups();
  groupFileMessage.innerText =
    `Loaded ${imported.persons.length} profiles ` +
    `(${result.ids.length} members and their ancestors): ` +
    `${result.added} new, ${result.replaced} updated from the file, ` +
    `${result.kept} kept as in the database`;
}

async function importFromFile(file) {
  let imported;
  try {
    imported = parseExport(await file.text());
  } catch (error) {
    showErrorMessage('Could not load ' + file.name + ': ' + error.message);
    return;
  }
  if (
    !confirm(
      'Replace the current database and all groups with the ' +
        'contents of ' +
        file.name +
        '?',
    )
  ) {
    return;
  }
  const importedGroup = applyImport(imported, db, groupStore);
  await saveDatabaseSnapshot();
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
    startUserOperation();
    await switchToGroup(groupSelectElement.value);
  }
});

groupNotesElement.addEventListener('input', () => {
  groupStore.saveNotes(currentGroup, groupNotesElement.value);
});

newGroupCreateButton.addEventListener('click', () => {
  startUserOperation();
  createNewGroup();
});

newGroupNameElement.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    startUserOperation();
    createNewGroup();
  } else if (event.key === 'Escape') {
    cancelNewGroup();
  }
});

newGroupCancelButton.addEventListener('click', () => {
  cancelNewGroup();
});

saveGroupButton.addEventListener('click', () => {
  startUserOperation();
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
    startUserOperation();
    await loadGroupFromFile(file);
  }
});

addProfileElement.addEventListener('change', async () => {
  console.log('Change event detected');
  startUserOperation();
  addProfile();
});

addProfileButton.addEventListener('click', async () => {
  console.log('Click detected');
  startUserOperation();
  addProfile();
});

saveDatabaseButton.addEventListener('click', async () => {
  startUserOperation();
  await saveCurrentState();
});

exportFileButton.addEventListener('click', () => {
  startUserOperation();
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
    startUserOperation();
    await importFromFile(file);
  }
});

buildTreeButton.addEventListener('click', async () => {
  startUserOperation();
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
  startUserOperation();
  buildAncestorGroups();
});

initialsOnlyElement.addEventListener('change', () => {
  localStorage.setItem(initialsOnlyKey, initialsOnlyElement.checked);
  displayProfileList();
  displayAncestorGroups();
});

algorithmSelectElement.addEventListener('change', () => {
  startUserOperation();
  localStorage.setItem(algorithmKey, algorithmSelectElement.value);
  buildAncestorGroups();
});

// ===== Initialize the page from last saved state ====
await loadDatabase(db);
lastDatabaseSize = db.size();
profileAdditionCount = 0;
savedProfileAdditionCount = 0;
console.log('Database size', db.size());
displayAlgorithmSelect();
initialsOnlyElement.checked = localStorage.getItem(initialsOnlyKey) === 'true';
selectGroup(groupStore.currentName());
buildAncestorGroups();
