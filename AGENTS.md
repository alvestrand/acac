# Repository Guidelines

## Project Structure & Module Organization

ACAC is a browser-only JavaScript application with no server or build
step. `index.html` and `index.js` provide the main interface. Source
modules and their `*.test.js` files are at the repository root; `doc/`
contains project documentation, while `simulations/` and standalone
HTML pages are experiments and API tools. For detailed module
responsibilities, the database model, tree and path behavior, Geni API
findings, and known issues, consult
[`doc/architecture.md`](doc/architecture.md) when working in those
areas.

## Build, Test, and Development Commands

- `npm test` runs the Jest suite with Node’s experimental VM modules
  enabled.
- `npm test -- --runInBand` runs the same tests serially, which can
  make output easier to inspect.
- Open `index.html` from a local static server to use ACAC. The app
  reads the Geni app ID from the gitignored `.geni_app_id` file.
- Open `testpage.html` to make an individual Geni API request and
  inspect its raw response.

There is no compile or bundling command. The code requires Node 22 or
newer for tests.

## Coding Style & Naming Conventions

Use two-space indentation, single-quoted JavaScript strings,
semicolons, and plain ES modules. Keep modules focused on their
existing responsibility; put display calculations in
`display_functions.js` and leave DOM construction in `index.js`. Use
descriptive camelCase names for functions and variables, and
`*.test.js` for tests. There is no JavaScript formatter or linter
linting configured. Before committing, run Prettier on every modified
JavaScript file and `mdformat` on every modified `.md` file.

## Testing Guidelines

Tests use Jest and should follow the existing module-focused pattern.
Use `FakeGeniClient` for tree-building tests and mock the Geni SDK for
request-queue tests. Run `npm test` after changes. `index.js` has no
automated UI tests, so page changes should also be tried in a browser
and that limitation reported.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries (for example,
`Add bounded Geni path tracing`); add a brief body when context helps.
Work on a new branch based on an up-to-date `main`. Commit only when
asked, and split unrelated work into separate commits. The maintainer
handles pushing branches and opening and merging pull requests. Before
relying on uncertain Geni API behavior, check it with `testpage.html`;
report what was verified and what remains uncertain. Describe the
change and test results in the handoff; include screenshots for
visible UI changes when useful.

## Security & Configuration

Keep `.geni_app_id` and `samples/` data out of commits. Sample API
responses may contain personal information; do not copy real profile
data into tests or documentation.
