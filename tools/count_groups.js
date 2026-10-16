// Run by hand: reports how many ancestor groups are found for each
// group in a saved database file, with each grouping algorithm,
// so that the algorithms can be compared.
//
// Usage: node tools/count_groups.js [file] [--algorithm=a,b] [--verbose]
// The file defaults to samples/database.json, and all algorithms in
// groupingAlgorithms are run unless --algorithm names some of them.
// --verbose keeps the progress logging from ancestor_finder.js and lists
// each ancestor group with its members and closest common ancestors.
//
// For each group with more than one member, "generations" is how far
// back the closest common ancestor is from the farthest member.

import { readFileSync } from 'node:fs';
import { Database } from '../database.js';
import { parseExport } from '../file_export.js';
import { profileIds } from '../groups.js';
import { groupingAlgorithms, removeInnerParents }
  from '../ancestor_finder.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const fileName = args.find(arg => !arg.startsWith('--'))
  ?? 'samples/database.json';
const algorithmArg = args.find(arg => arg.startsWith('--algorithm='));
const algorithmNames = algorithmArg
  ? algorithmArg.substring('--algorithm='.length).split(',')
  : Object.keys(groupingAlgorithms);
for (const name of algorithmNames) {
  if (!(name in groupingAlgorithms)) {
    console.error(`Unknown algorithm '${name}'. Known:`,
                  Object.keys(groupingAlgorithms).join(', '));
    process.exit(1);
  }
}

const imported = parseExport(readFileSync(fileName, 'utf8'));
const db = new Database();
db.fromJsonObject(imported);
db.createAncestors();
console.log(`${fileName}: ${db.size()} persons,`,
            `${Object.keys(imported.groups).length} groups`);

// ancestor_finder.js logs a lot; keep it quiet unless asked.
const log = console.log;
function quietly(fn) {
  if (!verbose) {
    console.log = () => {};
  }
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

function describe(person) {
  return `${person.name()} (${person.birth() ?? '?'})`;
}

// Generations back to the group's closest common ancestor.
function closestGenerations(group) {
  return Math.min(...group.generations.values());
}

const width = Math.max(...algorithmNames.map(name => name.length));

for (const [name, entries] of Object.entries(imported.groups)) {
  const ids = profileIds(entries);
  const persons = ids.map(id => db.get(id)).filter(person => person);
  const missing = ids.length - persons.length;
  log(`\nGroup '${name}': ${ids.length} members`
      + (missing ? ` (${missing} not in database)` : ''));
  for (const algorithm of algorithmNames) {
    const groups = quietly(
      () => groupingAlgorithms[algorithm](persons, db));
    const shared = groups.filter(group => group.persons.length > 1);
    log(`  ${algorithm.padEnd(width)}  ${groups.length} ancestor groups,`,
        `${shared.length} with more than one member;`,
        'sizes', shared.map(group => group.persons.length).join(',') || '-',
        'generations', shared.map(closestGenerations).join(',') || '-');
    if (verbose) {
      groups.forEach((group, index) => {
        log(`    ${index + 1}: ${group.persons.length} persons,`,
            `${group.ancestors.size} common ancestors`);
        group.persons.forEach(
          person => log(`         member ${describe(person)}`));
        if (group.persons.length > 1) {
          const closest = quietly(
            () => removeInnerParents(db, group.ancestors));
          closest.forEach(
            person => log(`         closest ${describe(person)}`));
        }
      });
    }
  }
}
