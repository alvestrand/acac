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
- `node tools/make_screenshots.js` regenerates the ACAC screenshots in
  `doc/` from the invented family in `tools/sample-group.json`, using
  headless Chrome (set `CHROME_PATH` if it is not found).

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
JavaScript file and `mdformat` on every modified `.md` file. Then use
pandoc to make an HTML file next to every `.md` file in `doc/`, and
commit the changed HTML files with the Markdown:

```sh
for f in doc/*.md; do
  pandoc --standalone --metadata pagetitle="$(basename "$f" .md)" \
    "$f" -o "${f%.md}.html"
done
```

## Testing Guidelines

Tests use Jest and should follow the existing module-focused pattern.
Use `FakeGeniClient` for tree-building tests and mock the Geni SDK for
request-queue tests. Run `npm test` after changes. For `index.js`
there is only a smoke test, `index_page.test.js`, which loads the page
in headless Chrome with puppeteer-core and checks that it starts
without errors. It is skipped if no Chrome is found; set `CHROME_PATH`
to point it at one. Page changes should also be tried in a browser and
that limitation reported.

## Updating the Documentation

When asked to "update the documentation":

1. Run `node tools/make_screenshots.js` to regenerate
   `doc/acac-result.png` ("Show" set to "No path") and
   `doc/acac-result-expanded.png` ("Show" set to "Tree"). Look at both
   images and check that they still show what the text says about
   them. If a page change makes them misleading or uninteresting,
   change the script or `tools/sample-group.json`. The sample family
   is invented, so names are shown in full ("Show initials only" off);
   keep it invented and never use profiles from `samples/` or Geni.
1. Check the user documentation against the current page: the
   hand-written `doc/index.html`, `doc/myheritage-find-profiles.md`,
   and `README.md`. Compare button labels, menu entries, settings, and
   described behavior with `index.html` and `index.js`, and fix text
   and image alt texts that no longer match. Describe new user-visible
   features where they fit.
1. Check `doc/architecture.md` against the code: module
   responsibilities, behavior, Geni API findings, and known issues.
1. The DNAPainter and Geni screenshots in `doc/` cannot be
   regenerated; report any that look outdated instead of replacing
   them.
1. Format and regenerate the HTML as described under Coding Style, and
   report what was changed and what could not be checked.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries (for example,
`Add bounded Geni path tracing`); add a brief body when context helps.
Work on a new branch based on an up-to-date `main`. Commit only when
asked, and split unrelated work into separate commits. The maintainer
handles pushing branches and opening and merging pull requests. Before
relying on uncertain Geni API behavior, check it with `testpage.html`;
report what was verified and what remains uncertain. Describe the
change and test results in the handoff; include screenshots for
visible UI changes when useful. All changes must be made on a branch;
never commit on `main`. Before committing, verify the current branch
is not `main`.

## Security & Configuration

Keep `.geni_app_id` and `samples/` data out of commits. Sample API
responses may contain personal information; do not copy real profile
data into tests or documentation.
