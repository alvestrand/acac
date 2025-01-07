import { Person, Database } from '../database.js';

let x = new Person;

console.log(x);

// Build a test tree.

let db = new Database;

// Array shuffle according to Durstenfeld, from StackOverflow
function shuffleArray(array) {
    for (let i = array.length - 1; i >= 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function addGeneration(generation, childCount) {
  console.log('Adding generation ', generation, ' with ', childCount, ' children per couple');
  // For test tree, we use birth year as generation index.
  let fathers = db.getAllWithBirthYearAndGender(generation - 1, 'male');
  let mothers = db.getAllWithBirthYearAndGender(generation - 1, 'female');
  shuffleArray(fathers);
  shuffleArray(mothers);
  let childno = 1;
  console.log('Number of couples for gen ', generation, ' is ', Math.min(fathers.length, mothers.length));
  while (fathers.length > 0 && mothers.length > 0) {
    const father = fathers.pop();
    const mother = mothers.pop();
    if (father && mother) {
      for (let j = 1; j <= childCount; j++) {
        const name = 'gen' + generation + 'child' + childno;
        let gender = 'male';
        if (childno % 2 === 0) {
          gender = 'female';
        }
        db.addWithAttributes(name, {name: name, birth: generation, father: father.id(), mother: mother.id(), gender: gender});
        childno += 1;
        father.markers.forEach(marker => {
          if (Math.random() < 0.45) {
            console.log('Passing on ', marker, ' from father to ', name);
            db.get(name).markers.add(marker);
          }
        });
        mother.markers.forEach(marker => {
          if (Math.random() < 0.45) {
            console.log('Passing on ', marker, ' from mother to ', name);
            db.get(name).markers.add(marker);
          }
        });
      }
    }
  }
}

function buildTestTree(startingPopulation, generations, childCount) {
  console.log(`Building tree with ${startingPopulation} starting population and ${generations} generations`);
  console.log(`Adding ${childCount} children per couple`);
  for (let i = 1; i <= startingPopulation / 2; i++) {
    db.addWithAttributes('progM' + i, {name: 'progM' + i, gender: 'male', birth: 0});
    db.addWithAttributes('progF' + i, {name: 'progF' + i, gender:
                                      'female', birth: 0});
  }
  db.get('progM1').markers.add('Mark');
  for (let generation = 1; generation < generations; generation++) {
    addGeneration(generation, childCount);
  }
}

function runAlgorithm(generation) {
  let lastGenerationPersons = db.getAllWithBirthYearAndGender(generation-1, 'all');
  console.log('Size of last generation: ', lastGenerationPersons.length);
  let markedPersons = lastGenerationPersons.filter(person => person.markers.has('Mark'));
  console.log('Number of marked persons: ', markedPersons.length);
  if (markedPersons.length < 1) {
    console.log('Marker died out');
    return [ 0, 'died out' ];
  }
  if (markedPersons.length < 2) {
    console.log('Too few candidates, pointless');
    return [ markedPersons.length, "pointless" ];
  }
  let candidates = markedPersons[0].ancestors();
  for (let i = 1; i < markedPersons.length; i++) {
    candidates = candidates.intersection(markedPersons[i].ancestors());
  }
  console.log('Remaining candidates are ', candidates);
  return [ markedPersons.length, candidates.size ];
}

// Tie the document's buttons and fields to the build functions.
document.getElementById("build-test-tree").addEventListener('click', () => {
  db.clear();
  buildTestTree(document.getElementById('starting_population').value,
                document.getElementById('generations').value,
                document.getElementById('child_count').value);
  console.log('Built tree with ', db.size(), ' members');
});

document.getElementById('fill-in-ancestors').addEventListener('click', () => {
  db.createAncestors();
});

document.getElementById('run-algorithm').addEventListener('click', () => {
  runAlgorithm(document.getElementById('generations').value);
});

document.getElementById('test-a-tree').addEventListener('click', () => {
  db.clear();
  buildTestTree(document.getElementById('starting_population').value,
                document.getElementById('generations').value,
                document.getElementById('child_count').value);
  db.createAncestors();
  const [ candidates, result ] = runAlgorithm(document.getElementById('generations').value);
  document.getElementById('marked-folks').innerText = candidates;
  document.getElementById('progenitor-candidates').innerText = result;
});
