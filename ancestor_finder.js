// Algorithm for finding common ancestors.

export {
  scoringAlgorithms,
  makeGroupList,
  removeInnerParents
};

class CommonAncestorGroup {
  constructor(rootPerson) {
    this.persons = [ rootPerson ];
    this.ancestors = new Set(rootPerson.ancestors());
    // Generations back from the farthest member to each common ancestor.
    this.generations = new Map(rootPerson.ancestorGenerations());
  }
  mergeGroup(group) {
    this.persons.push(...group.persons);
    this.ancestors = this.ancestors.intersection(group.ancestors);
    const generations = new Map();
    for (const id of this.ancestors) {
      generations.set(id, Math.max(this.generations.get(id),
                                   group.generations.get(id)));
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
      score = Math.max(score, 2 ** -(group1.generations.get(id)
                                     + group2.generations.get(id)));
    }
    return score;
  }
};

function mergeOverlappingGroups(groupList, score) {
  // Find the two groups with the highest score, and merge them.
  let firstGroup;
  let secondGroup;
  let maxScore = 0;
  groupList.forEach(entry1 => {
    groupList.forEach(entry2 => {
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
    return groupList;  // No change
  }
  console.log('Merging', firstGroup.persons[0].name(), 'with', secondGroup.persons[0].name());
  firstGroup.mergeGroup(secondGroup);
  const newGroupList = groupList.filter(group => group != secondGroup);
  return newGroupList;
}

// Start with one group per person, and merge the highest scoring pair
// of groups until no two groups share any ancestor. The score is one of
// scoringAlgorithms, so that they can be compared on the same data.
function makeGroupList(personList,
                       score = scoringAlgorithms.sharedAncestors) {
  let groupList = personList.map(person => new CommonAncestorGroup(person));
  let currentSize = groupList.length;
  while (true) {
    console.log('Group list length is ', currentSize);
    groupList = mergeOverlappingGroups(groupList, score);
    if (currentSize == groupList.length) {
      return groupList;
    }
    currentSize = groupList.length;
  }
}

// Takes a Set(ancestor id) and removes
// those people who have children in the set.
// The return value is a Set containing the person entries.
// The theory on what to remove is a bit iffy.
function removeInnerParents(db, groupAncestors) {
  const ancestorList = groupAncestors.values().map(
      ancestor => db.get(ancestor)).toArray();
  let potentialInnerIdSet = new Set();
  // Theory: If a person is in the list, all their ancestors will also
  // be there, and therefore don't add new information.
  ancestorList.map(person => {
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
  const edgePeople = edgePeopleIds.values().map(
      ancestor => db.get(ancestor)).toArray();
  return new Set(edgePeople);
}
