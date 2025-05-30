// Algorithm for finding common ancestors.

export {
  CommonAncestorGroup,
  mergeWithSomeGroup,
  makeGroupList,
  removeInnerParents
};

class CommonAncestorGroup {
  constructor(rootPerson) {
    this.persons = [ rootPerson ];
    this.ancestors = new Set(rootPerson.ancestors());
  }
  sizeAfterMerge(person) {
    return this.ancestors.intersection(person.ancestors()).size;
  }
  mergePerson(person) {
    this.persons.push(person);
    this.ancestors = this.ancestors.intersection(person.ancestors());
  }
  mergeGroup(group) {
    this.persons.push(...group.persons);
    this.ancestors = this.ancestors.intersection(group.ancestors);
  }
}

function mergeWithSomeGroup(person, groupList) {
  // find the group that will reduce the least by merging this.
  // This will hopefully merge close relatives in the same group.
  const new_sizes = groupList.map(entry => entry.sizeAfterMerge(person));
  let smallestShrinkage = Number.MAX_SAFE_INTEGER;
  let chosenGroup;
  console.log(`Grouping ${person.name()}, new sizes`, new_sizes);
  for (let idx = 0; idx < new_sizes.length; idx++) {
    if (new_sizes[idx] > 0) {
      const shrinkage = groupList[idx].ancestors.size - new_sizes[idx];
      if (shrinkage < smallestShrinkage) {
        smallestShrinkage = shrinkage;
        chosenGroup = idx;
      }
    }
  }
  console.log('Smallest shrinkage', smallestShrinkage,
              'chosen group', chosenGroup);
  if (chosenGroup === undefined) {
    // No groups, or all groups resolve to zero. Add one.
    const newGroup = new CommonAncestorGroup(person);
    groupList.push(newGroup);
  } else {
    groupList[chosenGroup].mergePerson(person);
  }
}

// First attempt
function makeGroupList1(personList) {
  let groupList = new Array();
  personList.map(person => {
    mergeWithSomeGroup(person, groupList);
  });
  return groupList;
}

function mergeOverlappingGroups(groupList) {
  // Find the two groups with the most ancestors in common, and merge them.
  let firstGroup;
  let secondGroup;
  let maxMatch = 0;
  groupList.forEach(entry1 => {
    groupList.forEach(entry2 => {
      if (entry1 != entry2) {
        const overlap = entry1.ancestors.intersection(entry2.ancestors).size;
        if (overlap > maxMatch) {
          firstGroup = entry1;
          secondGroup = entry2;
          maxMatch = overlap;
        }
      }
    });
  });
  if (maxMatch === 0) {
    return groupList;  // No change
  }
  console.log('Merging', firstGroup.persons[0].name(), 'with', secondGroup.persons[0].name());
  firstGroup.mergeGroup(secondGroup);
  const newGroupList = groupList.filter(group => group != secondGroup);
  return newGroupList;
}

// Second attempt
function makeGroupList(personList) {
  let groupList = personList.map(person => new CommonAncestorGroup(person));
  let currentSize = groupList.length;
  while (true) {
    console.log('Group list length is ', currentSize);
    groupList = mergeOverlappingGroups(groupList);
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
