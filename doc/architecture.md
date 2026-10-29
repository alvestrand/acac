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
  supports stopping and restarting fetches.
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
  matching, stored in localStorage.
- `file_export.js`: whole-database and group export/import. When
  merging records, newer Geni `updated_at` data replaces older
  attributes while parent links from either record are retained.
- `opfsdb.js`: persistence of the profile database in the Origin
  Private File System.
- `fake_geni_client.js`: an in-memory Geni API fake used by
  `tree_builder.test.js`.
- `tools/count_groups.js`: manually compares grouping algorithms on a
  saved database.

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
- Rate-limit responses include `X-API-Rate-Limit`,
  `X-API-Rate-Remaining`, and `X-API-Rate-Window`. Parallel requests
  do not improve throughput.
- `profile/path-to` returns ordered relation entries with names and
  profile API URLs; sample responses also include `step_count`. A
  relation's label such as `brother` or `son` is not sufficient to
  infer parent links, so ACAC uses unions.

## Known Issues and Limits

- `index.js` has no automated UI tests. Test UI changes in a browser
  when possible; API behavior can be inspected with `testpage.html`.
