# ACAC Architecture

ACAC is a browser-only app that uses the Geni API to find common
ancestors for a group of profiles. The browser fetches data with the
user's Geni login and stores the local cache in the Origin Private
File System. There is no application server.

## Main Data Flow

`index.js` owns page state and DOM construction: profile and group
actions, tree-building controls, import/export, and status messages.
`TreeBuilder` fetches profiles, unions, and parents through an
injected Geni client, stores profiles in the database, and follows
merges. After fetching, `Database.createAncestors()` rebuilds ancestor
sets and generation distances; `ancestor_finder.js` uses those to
group profiles. `display_functions.js` computes display values without
touching the DOM, so those calculations can be tested separately.

## Module Responsibilities

- `async_geni.js`: `GeniClient` serializes API operations through one
  queue, retries Geni rate-limit responses after five seconds, and
  supports stopping and restarting fetches. It keeps the Geni access
  and refresh tokens in the storage it is given (sessionStorage in
  `index.js`) and passes them to `Geni.init`, so a reloaded or
  duplicated tab stays logged in while a new tab logs in for itself.
  When Geni answers an `OAuthException` that the SDK could not cure by
  refreshing the token, the client forgets the login, stops fetching,
  and calls `onLoggedOut`.
- `tree_builder.js`: `TreeBuilder` fetches profiles to add, builds
  ancestors to a year or generation limit, and refreshes trees through
  a shared pool so shared ancestors are refreshed once. It follows
  `merged_into`, records merges, and reports unexpected API answers
  through hooks. Path results are imported by profile API URL; their
  union data, rather than the path's relation labels, establishes
  parent links.
- `database.js`: `Person` and `Database` hold records and derived
  ancestor data. Profile records are keyed by Geni GUID;
  `getByIdAttribute` maps Geni's `profile-<id>` identifiers to GUIDs.
  `father()` and `mother()` contain GUIDs. `parents` contains API
  URLs, with `undefined` meaning not fetched and `[]` meaning no known
  parents. Merges retain aliases so older references still resolve.
- `geni_structures.js`: API structure helpers, including
  `resolveParents`, `isolateId`, and `profileFields`. A field used by
  the app must be added to `profileFields`; the fake client filters
  profile data using that list too.
- `ancestor_finder.js`: grouping algorithms based on shared ancestors,
  kinship scores, closest ancestors, completeness, or root
  descendants. The selected profile groups and their display contents
  are built in `index.js` using `display_functions.js`.
- `groups.js`: group membership, notes, and profiles excluded from
  matching, held in memory by `GroupStore` and saved in the database
  file by `opfsdb.js`. `mergeGroups` merges the groups of two tabs
  three ways; both notes texts are kept, separated by `\n---\n`, when
  both tabs changed them. `readStoredGroups` reads the groups that
  older versions kept in localStorage. The name of the current group
  is not part of the groups: each tab keeps its own in `index.js`,
  remembered in sessionStorage, and a new tab starts with the one in
  the database file (see `opfsdb.js`).
- `file_export.js`: whole-database and group export/import. When
  merging records, newer Geni `updated_at` data replaces older
  attributes while parent links from either record are retained.
- `opfsdb.js`: `DatabaseFile` persists the profile database and groups
  in one file in the Origin Private File System. The file has a
  version number that is incremented on each save. If the stored
  version is higher than the one the tab last loaded or saved, another
  tab has saved, and the stored data is merged into the tab's
  (`Database.mergeFrom`, `mergeGroups`) before saving. Saves run under
  a Web Lock. A file with no `groups` is migrated from localStorage.
  Each save also stores the saving tab's current group, which a new
  tab starts with; files from older versions have none, and the old
  `currentSet` key in localStorage is read instead. localStorage is
  only read. The page's display settings (initials only, grouping
  algorithm and year limit, "Show") are kept per tab in
  sessionStorage, so saving the file is the only change that reaches
  other tabs. Deleting profiles is not merged: a removed profile comes
  back from another tab's file.
- `fake_opfs.js`: in-memory fakes of the file system directory and Web
  Locks, used by `opfsdb.test.js`.
- `fake_geni_client.js`: an in-memory Geni API fake used by
  `tree_builder.test.js`.
- `tools/count_groups.js`: manually compares grouping algorithms on a
  saved database.
- `tools/make_screenshots.js`: regenerates the ACAC screenshots in
  `doc/` by loading the invented family in `tools/sample-group.json`
  into the page in headless Chrome (see "Updating the Documentation"
  in `AGENTS.md`).

## Tree Building and Path Search

Ordinary tree building follows parent links only while profiles meet
the UI's year limit; known profiles are not fetched again. The
per-profile path action searches from the selected profile to each
other profile in the group. Geni path results include both endpoints
in `relations`, a `step_count`, `relationship`, and a `status`. ACAC
reports counts for `done`, `pending`, `overloaded`, and `not found`;
it does not retry pending responses.

Paths longer than the configured length limit are discarded whole. For
accepted paths, ACAC fetches relation profiles using their API URLs,
stores them by GUID, and fetches unions to resolve parents. Profiles
fetched for this path expansion with a known birth year earlier than
the configured age limit are not added to the database. Missing birth
years do not fail that cutoff. The completion message reports
discarded paths and unique discarded profile IDs. New profile
additions are saved when the Geni request queue transitions from
non-empty to empty, after a short delay for response handlers to
finish.

## Geni API Findings

These findings come from API experiments and should be rechecked if
Geni behavior changes:

- `profile/ancestors` works only for the logged-in user's own profile;
  other profiles return permission denied. Its `generations` parameter
  has failed with both numeric and string values, so tree building
  uses profile and union requests instead.
- `fields=` selects profile fields, and requesting nested `birth`
  returns `birth.date.year`. Profile records include `updated_at` as
  an epoch-seconds string and `profile_url` for browser links.
- A merged profile is expected to return `merged_into` as a profile
  API URL; the client follows that pointer. Unexpected profile answers
  stop fetching for inspection.
- `profile?ids=a,b,c` and `/union` with `{ids: [...]}` support
  batching; the maximum batch size has not been established.
- In `jsdk.js`, cookie storage of the token is switched on with the
  option `cookies`, not `cookie`, and `init` reads the token cookie
  before it switches cookie support on, so the SDK cannot restore a
  login from its cookie. `init` accepts `access_token` and
  `refresh_token` instead. `Geni.connect` calls back with no answer if
  the SDK already has a token. On an `OAuthException` the SDK tries
  once to refresh the token, and only clears its token that first
  time. What Geni answers for an expired token, and how long tokens
  last, has not been observed; a made-up token gives `OAuthException`
  "Invalid access token".
- Rate-limit responses include `X-API-Rate-Limit`,
  `X-API-Rate-Remaining`, and `X-API-Rate-Window`. Parallel requests
  do not improve throughput.
- `profile/path-to` returns ordered relation entries with names and
  profile API URLs; sample responses also include `step_count`. A
  relation's label such as `brother` or `son` is not sufficient to
  infer parent links, so ACAC uses unions.

## Known Issues and Limits

- `index.js` has only a smoke test, `index_page.test.js`, which loads
  the page in headless Chrome and checks that it starts without
  errors. Test UI changes in a browser when possible; API behavior can
  be inspected with `testpage.html`.
