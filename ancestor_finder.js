// Algorithm for finding common ancestors.

export {
  scoringAlgorithms,
  groupingAlgorithms,
  makeGroupList,
  makeRootDescendantGroups,
  removeInnerParents,
};

class CommonAncestorGroup {
  constructor(rootPerson) {
    this.persons = [rootPerson];
    this.ancestors = new Set(rootPerson.ancestors());
    // Generations back from the farthest member to each common ancestor.
    this.generations = new Map(rootPerson.ancestorGenerations());
  }
  mergeGroup(group) {
    this.persons.push(...group.persons);
    this.ancestors = this.ancestors.intersection(group.ancestors);
    const generations = new Map();
    for (const id of this.ancestors) {
      generations.set(
        id,
        Math.max(this.generations.get(id), group.generations.get(id)),
      );
    }
    this.generations = generations;
  }
}

// Ways of scoring how closely two groups are related. makeGroupList
// merges the pair with the highest score, as long as it is above zero.
// Each takes two CommonAncestorGroups and returns a number.
const scoringAlgorithms = {
  // The number of common ancestors. Favours members with deep trees.
  sharedAncestors(group1, group2) {
    return group1.ancestors.intersection(group2.ancestors).size;
  },
  // Each common ancestor counts 2^-(g1 + g2), where g1 and g2 are the
  // generations back from each group, so close relatives count far more
  // than many distant ancestors. Close to the kinship coefficient, but it
  // uses only the shortest path, and also counts the ancestors of the
  // closest common ancestors.
  kinship(group1, group2) {
    let score = 0;
    for (const id of group1.ancestors.intersection(group2.ancestors)) {
      score += 2 ** -(group1.generations.get(id) + group2.generations.get(id));
    }
    return score;
  },
  // Only the closest common ancestor counts: 2^-(g1 + g2) for the
  // ancestor with the smallest g1 + g2.
  closestAncestor(group1, group2) {
    let score = 0;
    for (const id of group1.ancestors.intersection(group2.ancestors)) {
      score = Math.max(
        score,
        2 ** -(group1.generations.get(id) + group2.generations.get(id)),
      );
    }
    return score;
  },
};

function mergeOverlappingGroups(groupList, score) {
  // Find the two groups with the highest score, and merge them.
  let firstGroup;
  let secondGroup;
  let maxScore = 0;
  groupList.forEach((entry1) => {
    groupList.forEach((entry2) => {
      if (entry1 != entry2) {
        const pairScore = score(entry1, entry2);
        if (pairScore > maxScore) {
          firstGroup = entry1;
          secondGroup = entry2;
          maxScore = pairScore;
        }
      }
    });
  });
  if (maxScore === 0) {
    return groupList; // No change
  }
  firstGroup.mergeGroup(secondGroup);
  const newGroupList = groupList.filter((group) => group != secondGroup);
  return newGroupList;
}

// Another way of choosing which groups to merge: take the group whose
// first member has the highest completeness index, and merge it with the
// highest scoring group. If no group scores above zero, go on to the
// next most complete. The idea is that the best known trees give the
// most reliable common ancestors. Ties go to the more complete partner.
function mergeMostCompleteFirst(groupList, score) {
  const byCompleteness = groupList.toSorted(
    (a, b) =>
      b.persons[0].completenessIndex() - a.persons[0].completenessIndex(),
  );
  for (const group of byCompleteness) {
    let partner;
    let maxScore = 0;
    for (const other of byCompleteness) {
      if (other != group) {
        const pairScore = score(group, other);
        if (pairScore > maxScore) {
          partner = other;
          maxScore = pairScore;
        }
      }
    }
    if (partner) {
      console.log(
        'Merging',
        group.persons[0].name(),
        'with',
        partner.persons[0].name(),
      );
      group.mergeGroup(partner);
      return groupList.filter((entry) => entry != partner);
    }
  }
  return groupList; // No change
}

// Start with one group per person, and merge pairs of groups until no
// two groups share any ancestor. The score is one of scoringAlgorithms,
// so that they can be compared on the same data. merge picks the pair:
// by default the highest scoring one.
function makeGroupList(
  personList,
  score = scoringAlgorithms.sharedAncestors,
  merge = mergeOverlappingGroups,
) {
  let groupList = personList.map((person) => new CommonAncestorGroup(person));
  let currentSize = groupList.length;
  while (true) {
    groupList = merge(groupList, score);
    if (currentSize == groupList.length) {
      return groupList;
    }
    currentSize = groupList.length;
  }
}

// Look at the ancestors who have no known ancestors themselves (the
// roots of the trees), and make a group of the persons descending from
// the root with the most descendants among them. Repeat with the persons
// not yet grouped, until no root has more than one descendant left.
// Those left over get a group each, as in makeGroupList.
// Ties go to the root found first.
function makeRootDescendantGroups(personList, db) {
  const groupList = [];
  let remaining = personList;
  while (true) {
    const descendants = new Map(); // root id -> [person]
    for (const person of remaining) {
      for (const id of person.ancestors()) {
        if (db.get(id).ancestors().size === 0) {
          if (!descendants.has(id)) {
            descendants.set(id, []);
          }
          descendants.get(id).push(person);
        }
      }
    }
    let members = [];
    for (const persons of descendants.values()) {
      if (persons.length > members.length) {
        members = persons;
      }
    }
    if (members.length < 2) {
      break;
    }
    const group = new CommonAncestorGroup(members[0]);
    members
      .slice(1)
      .forEach((person) => group.mergeGroup(new CommonAncestorGroup(person)));
    groupList.push(group);
    remaining = remaining.filter((person) => !members.includes(person));
  }
  return groupList.concat(
    remaining.map((person) => new CommonAncestorGroup(person)),
  );
}

// All ways of making the group list, by name, for the user to choose
// between. Each takes a list of persons and the database they are in,
// and returns a list of CommonAncestorGroups.
const groupingAlgorithms = {
  sharedAncestors: (persons) =>
    makeGroupList(persons, scoringAlgorithms.sharedAncestors),
  kinship: (persons) => makeGroupList(persons, scoringAlgorithms.kinship),
  closestAncestor: (persons) =>
    makeGroupList(persons, scoringAlgorithms.closestAncestor),
  sharedAncestorsCompleteness: (persons) =>
    makeGroupList(
      persons,
      scoringAlgorithms.sharedAncestors,
      mergeMostCompleteFirst,
    ),
  kinshipCompleteness: (persons) =>
    makeGroupList(persons, scoringAlgorithms.kinship, mergeMostCompleteFirst),
  closestAncestorCompleteness: (persons) =>
    makeGroupList(
      persons,
      scoringAlgorithms.closestAncestor,
      mergeMostCompleteFirst,
    ),
  rootDescendants: makeRootDescendantGroups,
};

// Takes a Set(ancestor id) and removes
// those people who have children in the set.
// The return value is a Set containing the person entries.
// The theory on what to remove is a bit iffy.
function removeInnerParents(db, groupAncestors) {
  const ancestorList = groupAncestors
    .values()
    .map((ancestor) => db.get(ancestor))
    .toArray();
  let potentialInnerIdSet = new Set();
  // Theory: If a person is in the list, all their ancestors will also
  // be there, and therefore don't add new information.
  ancestorList.map((person) => {
    potentialInnerIdSet = potentialInnerIdSet.union(person.ancestors());
  });
  // In theory, potentialInners is a subset of groupAncestors.
  // Verify.
  const subsetSize = potentialInnerIdSet.intersection(groupAncestors).size;
  if (subsetSize != potentialInnerIdSet.size) {
    console.log('Error: not all potential inners were in set');
  }
  const edgePeopleIds = groupAncestors.difference(potentialInnerIdSet);
  // This should be >= 1 person. Verify.
  if (edgePeopleIds.size < 1) {
    console.log('Error: No edge people');
  }
  // Pick people records for the edge people
  const edgePeople = edgePeopleIds
    .values()
    .map((ancestor) => db.get(ancestor))
    .toArray();
  return new Set(edgePeople);
}
