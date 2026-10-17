# ACAC - All Common Ancestors Considered

A browser-only JavaScript app that uses the geni.com API to find the
common ancestors of a group of profiles, typically DNA matches that share
a segment. See README.md for the purpose. There is no server side: data
is fetched with the user's Geni login and cached in the browser.

## Running and testing

- `npm test` runs the Jest tests (needs `--experimental-vm-modules`,
  already in the script). Node 22 or newer is required: the code uses
  Set methods (`union`, `intersection`, `difference`) and iterator
  helpers (`.values().map().toArray()`).
- CI: `.github/workflows/test.yml` runs `npm ci` and `npm test` on pull
  requests and pushes to main (free, since the repo is public).
- The app is plain ES modules served as static files; open `index.html`.
  It reads the Geni app id from `.geni_app_id` (gitignored) next to it.
- Tests cover the non-UI modules. `index.js` (page code) has no tests;
  page changes must be tried in a browser, which Claude can't do, so say
  so when reporting.
- `testpage.html` runs a single Geni API call (path + JSON parameters)
  outside the queue and shows the raw answer. Use it to find out how the
  API behaves before writing code against it.
- `samples/` (gitignored) holds sample API answers. They contain
  personal data: never commit them or copy real data into tests.

## Code layout

- `index.js`: page logic. Adding profiles, tree building
  (`buildTreeForPerson`, recursive, stops at the "back to" year limit;
  `rebuildTree`, from the profile menu, fetches it all again through a
  refresh pool shared by all running rebuilds, so that shared ancestors
  are refreshed once; the "already refreshed" set is only emptied when
  the pool is empty),
  group handling, file save/load, display.
- `async_geni.js`: `GeniClient`, a queue running one Geni request at a
  time. The next request starts as soon as the previous one is answered;
  on "Rate limit exceeded." it retries after 5 s. `stop()`/`start()` back
  the "Stop fetching" button. `queueSizeView(size, waiting)` drives the
  queue indicator.
- `database.js`: `Person` and `Database`. Persons are keyed by Geni
  **guid**; `getByIdAttribute` maps the `profile-<n>` id to the guid.
  Parent links: `father()`/`mother()` hold guids; the public `parents`
  property holds parent profile API URLs
  (`https://www.geni.com/api/profile-<n>`); `parents === undefined`
  means not fetched yet, `[]` means no known parents.
  `createAncestors()` rebuilds all ancestor sets; `merge(old, new)`
  records a Geni merge: links to the old guid are moved to the new one,
  and the old guid is kept as an alias that `get()` follows (saved with
  the database); `ancestorIds(id)` walks
  the links and is always up to date (used for running counts and group
  export). The completeness index (0.25 per known parent plus a quarter
  of each parent's index; 1 is a full tree) is built by
  `createAncestors()` as `Person.completenessIndex()`, and worked out
  fresh by `Database.completenessIndex(id)` for the running display.
- `geni_structures.js`: knowledge of Geni's data formats
  (`resolveParents` picks the birth union from a union list).
- `ancestor_finder.js`: groups profiles by shared ancestors
  (`makeGroupList`, `removeInnerParents`). `makeGroupList` takes one of
  `scoringAlgorithms` as its second argument (default `sharedAncestors`);
  the scores use `Person.ancestorGenerations()` (generations back to each
  ancestor, built by `createAncestors()`). `groupingAlgorithms` names
  every way of grouping, `(persons, db) => groups`, for the menu and the
  tool: one per scoring algorithm; one more per scoring algorithm named
  `<scoring>Completeness` (`makeGroupList` with `mergeMostCompleteFirst`
  as its third argument, merging the profile with the highest
  completeness index first; the menu labels these as the plain one plus
  " + consider completeness"); and `rootDescendants`
  (`makeRootDescendantGroups`).
- `tools/count_groups.js`: run by hand (`node tools/count_groups.js
  [file] [--algorithm=a,b] [--verbose]`) to compare the grouping
  algorithms on a saved database, by default `samples/database.json`.
- `groups.js`: `GroupStore`, groups of member ids in localStorage.
- `file_export.js`: save/load of the whole database, and of a single
  group with its members' ancestors (merge rule: replace a person only if
  Geni's `updated_at` is newer; keep parent links from either record).
- `opfsdb.js`: database persistence in the Origin Private File System.
- `simulations/`, `frontpage.html`: older experiments.

## Geni API findings

Found by experiment (October 2026); the API docs are thin.

- Rate limit: requests per time window, reported in the
  `X-API-Rate-Limit`, `X-API-Rate-Remaining` and `X-API-Rate-Window`
  headers. Parallel requests don't raise throughput; fewer requests do.
- `profile/ancestors` only works for the logged-in user's own profile;
  any other profile (ancestors, managed profiles) gets
  "Permission denied". Its `generations` parameter fails with
  "comparison of Integer with String failed" whether sent as number or
  text. Don't use it for tree building.
- `fields=` works for choosing profile fields. Edges in graph answers can
  carry `rel_modifier` (e.g. `"foster"`) for non-birth children.
- Merged profiles are answered with `merged_into` (a profile API URL),
  as the code assumes; not yet checked with the test page.
- `profile?ids=a,b,c` fetches several profiles at once, and `/union`
  takes `{ids: [...]}`. Batching per generation is the most promising way
  to cut the number of requests; the maximum ids per request is unknown.
- Profiles have `updated_at` (seconds since the epoch, as a string) and
  `profile_url` (the `geni.com/people/...` page used for name links).

## Known issues

- `resolveParents` checks `'adoped_children'` (typo), so adopted children
  are never detected.
- `GeniClient.connect` assumes `Geni.connect` always passes a response;
  the test page saw it pass none.

## Working with the maintainer

- Work on a new branch from an up-to-date `main` for each change. The
  maintainer pushes, opens and merges the pull requests on GitHub, and
  pulls `main`; then rebase or delete branches as needed.
- Commit only when asked. Split unrelated changes into separate commits;
  messages are a short summary line plus a paragraph explaining why.
- Match the existing style: two-space indentation, single quotes, short
  comments explaining intent, no frameworks or build step.
- Check API behaviour with the test page before building on assumptions,
  and say clearly what was verified and what wasn't.
