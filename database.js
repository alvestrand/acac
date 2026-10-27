// Class declarations for operating a database of person records.

import { urlToId, idToUrl } from './geni_structures.js';

class Person {
  // The identifier used for this person in Geni. String.
  #id;
  // A person record, fetched from Geni. Or a set of attributes generated for testing.
  #personRecord;
  // Ancestors, derived from Geni lookups. Set of string.
  #ancestors;
  // Generations back to each ancestor (1 for parents), by the shortest
  // path. Map of string -> number, with the same keys as #ancestors.
  #ancestorGenerations;
  // Completeness index: 0.25 for each known parent plus a quarter of
  // each parent's index. 1 means a complete tree. Built by addAncestors.
  #completeness;
  // ID of father and mother entry
  #father;
  #mother;
  // Birth year
  #birthYear;
  // 'male' or 'female'
  #gender;

  constructor(id, attributes) {
    this.#id = id;
    this.#setRecord(attributes);
    // For testing: Markers. This is a public attribute.
    this.markers = new Set();
  }

  // Take the person's data from a person record.
  #setRecord(attributes) {
    this.#personRecord = attributes;
    this.#father = undefined;
    this.#mother = undefined;
    this.#birthYear = undefined;
    this.#gender = undefined;
    if (attributes) {
      if ('father' in attributes) {
        this.#father = attributes.father;
      }
      if ('mother' in attributes) {
        this.#mother = attributes.mother;
      }
      if (
        'birth' in attributes &&
        'date' in attributes.birth &&
        'year' in attributes.birth.date
      ) {
        this.#birthYear = attributes.birth.date.year;
      }
      if ('gender' in attributes) {
        this.#gender = attributes.gender;
      }
    }
  }

  // Replace the person record with a newly fetched one, keeping the
  // object, so that lists holding it stay valid. Geni's records have no
  // parent links, so the current ones are kept until the caller sets
  // new ones; clearing them would cut off the tree in the meantime.
  updateAttributes(attributes) {
    const father = this.#father;
    const mother = this.#mother;
    this.#setRecord(attributes);
    this.setFather(father);
    this.setMother(mother);
  }

  toJSON() {
    return {
      id: this.#id,
      parents: this.parents,
      attributes: this.#personRecord,
      markers: this.markers,
    };
  }

  id() {
    return this.#id;
  }
  name() {
    return this.#personRecord.name;
  }
  birth() {
    return this.#birthYear;
  }
  gender() {
    return this.#gender;
  }
  unions() {
    return this.#personRecord.unions;
  }
  guid() {
    return this.#personRecord.guid;
  }
  attribute(selector) {
    return this.#personRecord[selector];
  }
  father() {
    return this.#father;
  }
  mother() {
    return this.#mother;
  }
  setFather(father) {
    this.#father = father;
    this.#personRecord.father = father;
  }
  setMother(mother) {
    this.#mother = mother;
    this.#personRecord.mother = mother;
  }
  // Build the set of all ancestors from the supplied database.
  // If it's already built, do nothing.
  addAncestors(db) {
    if (!this.#ancestors || this.#ancestors === undefined) {
      let father = db.get(this.#father);
      let mother = db.get(this.#mother);
      if (father) {
        father.addAncestors(db);
      }
      if (mother) {
        mother.addAncestors(db);
      }
      this.#ancestorGenerations = new Map();
      for (const parent of [father, mother]) {
        if (parent) {
          this.#addAncestorGeneration(parent.id(), 1);
          parent.#ancestorGenerations.forEach((generations, id) => {
            this.#addAncestorGeneration(id, generations + 1);
          });
        }
      }
      this.#ancestors = new Set(this.#ancestorGenerations.keys());
      this.#completeness = 0;
      for (const parent of [father, mother]) {
        if (parent) {
          this.#completeness += 0.25 + 0.25 * parent.#completeness;
        }
      }
    }
  }
  // Record an ancestor, keeping the shortest path if it is already known.
  #addAncestorGeneration(id, generations) {
    const known = this.#ancestorGenerations.get(id);
    if (known === undefined || generations < known) {
      this.#ancestorGenerations.set(id, generations);
    }
  }
  // Forget the set of ancestors, so that addAncestors builds it again.
  clearAncestors() {
    this.#ancestors = undefined;
    this.#ancestorGenerations = undefined;
    this.#completeness = undefined;
  }
  ancestors() {
    if (this.#ancestors === undefined) {
      return new Set();
    }
    return this.#ancestors;
  }
  // Map of ancestor id -> generations back, as built by addAncestors.
  ancestorGenerations() {
    if (this.#ancestorGenerations === undefined) {
      return new Map();
    }
    return this.#ancestorGenerations;
  }
  // The completeness index, as built by addAncestors.
  completenessIndex() {
    return this.#completeness ?? 0;
  }
}

class Database {
  // Person records. map of id -> Person.
  #persons;
  #idAttributeToGuidMap;
  // Profiles merged into others on Geni: map of old id -> current id.
  // Kept so that ids stored elsewhere (groups, files) still work.
  #mergedInto;
  constructor() {
    this.#persons = new Map();
    this.#idAttributeToGuidMap = new Map();
    this.#mergedInto = new Map();
    // Called with the new size whenever the number of entries changes.
    this.sizeView = (number) => {};
  }
  size() {
    return this.#persons.size;
  }
  clear() {
    this.#persons.clear();
    this.#idAttributeToGuidMap.clear();
    this.#mergedInto.clear();
    this.sizeView(this.#persons.size);
  }
  addPerson(person) {
    this.#persons.set(person.id(), person);
    this.#idAttributeToGuidMap.set(person.attribute('id'), person.id());
    this.sizeView(this.#persons.size);
    return person;
  }
  addWithAttributes(id, attributes) {
    let newPerson = new Person(id, attributes);
    return this.addPerson(newPerson);
  }
  // Replace the record of a person already in the database.
  updateAttributes(id, attributes) {
    const person = this.get(id);
    this.#idAttributeToGuidMap.delete(person.attribute('id'));
    person.updateAttributes(attributes);
    this.#idAttributeToGuidMap.set(person.attribute('id'), id);
    return person;
  }
  // Returns the person with the id, or the one it was merged into.
  get(id) {
    return this.#persons.get(this.currentId(id));
  }
  // The id a person has now, following merges.
  currentId(id) {
    return this.#mergedInto.get(id) ?? id;
  }
  isMerged(id) {
    return this.#mergedInto.has(id);
  }
  // Record that the profile oldId was merged into newId on Geni, which
  // must be in the database. The old person is removed, and all links
  // to it are changed to point to the new one, so that each person has
  // a single id in the parent links. Returns the number of persons whose
  // links were changed.
  merge(oldId, newId) {
    const newPerson = this.#persons.get(newId);
    if (oldId === newId || !newPerson) {
      return 0;
    }
    this.#mergedInto.set(oldId, newId);
    this.#mergedInto.forEach((current, id) => {
      if (current === oldId) {
        this.#mergedInto.set(id, newId);
      }
    });
    const oldPerson = this.#persons.get(oldId);
    if (!oldPerson) {
      return 0;
    }
    this.#persons.delete(oldId);
    const oldIdAttribute = oldPerson.attribute('id');
    if (oldIdAttribute !== undefined) {
      this.#idAttributeToGuidMap.set(oldIdAttribute, newId);
    }
    const newUrl = idToUrl(newPerson.attribute('id'));
    let changed = 0;
    this.#persons.forEach((person) => {
      let changedThis = false;
      if (person.father() === oldId) {
        person.setFather(newId);
        changedThis = true;
      }
      if (person.mother() === oldId) {
        person.setMother(newId);
        changedThis = true;
      }
      if (person.parents?.some((url) => urlToId(url) === oldIdAttribute)) {
        person.parents = person.parents.map((url) =>
          urlToId(url) === oldIdAttribute ? newUrl : url,
        );
        changedThis = true;
      }
      if (changedThis) {
        changed++;
      }
    });
    this.sizeView(this.#persons.size);
    return changed;
  }
  getByIdAttribute(idAttribute) {
    const guid = this.#idAttributeToGuidMap.get(idAttribute);
    if (guid) {
      return this.get(guid);
    }
    return undefined;
  }
  // Represent the database as an object suitable for JSON.stringify.
  toJsonObject() {
    return {
      persons: Object.fromEntries(this.#persons),
      merged: Object.fromEntries(this.#mergedInto),
    };
  }
  // Represent the database as a JSON string representation.
  toJsonString() {
    return JSON.stringify(this.toJsonObject(), null, 2);
  }
  // Initialize the database from a string representing a JSON object
  fromJsonString(data) {
    this.fromJsonObject(JSON.parse(data));
  }
  // Initialize the database from a parsed JSON object
  fromJsonObject(parsed) {
    for (const key in parsed.persons) {
      const entry = this.addWithAttributes(key, parsed.persons[key].attributes);
      // Special: restore the "parents" attribute
      if ('parents' in parsed.persons[key]) {
        entry.parents = parsed.persons[key].parents;
      }
    }
    for (const [oldId, newId] of Object.entries(parsed.merged ?? {})) {
      this.#mergedInto.set(oldId, newId);
    }
  }
  // For debugging: Return all records with a specific birth year
  getAllWithBirthYearAndGender(year, gender) {
    let result = [];
    this.#persons.forEach((value, key, map) => {
      if (
        value.birth() === year &&
        (gender === 'all' || value.gender() == gender)
      ) {
        result.push(value);
      }
    });
    return result;
  }
  // The ids of all known ancestors of a person, found by following the
  // father and mother links. Unlike Person.ancestors(), this is always
  // up to date, but it is worked out again on each call.
  ancestorIds(id) {
    const ancestors = new Set();
    const toVisit = [id];
    while (toVisit.length > 0) {
      const person = this.get(toVisit.pop());
      for (const parentId of [person?.father(), person?.mother()]) {
        if (parentId && this.get(parentId) && !ancestors.has(parentId)) {
          ancestors.add(parentId);
          toVisit.push(parentId);
        }
      }
    }
    return ancestors;
  }
  // The completeness index of a person (see Person), worked out from the
  // parent links. Like ancestorIds, this is always up to date.
  // memo maps ids already worked out to their index.
  completenessIndex(id, memo = new Map()) {
    if (memo.has(id)) {
      return memo.get(id);
    }
    // Guard against loops in the parent links.
    memo.set(id, 0);
    const person = this.get(id);
    let index = 0;
    for (const parentId of [person?.father(), person?.mother()]) {
      if (parentId && this.get(parentId)) {
        index += 0.25 + 0.25 * this.completenessIndex(parentId, memo);
      }
    }
    memo.set(id, index);
    return index;
  }
  // Build the ancestor sets of all entries from the current parent links.
  // Sets built earlier are rebuilt, since links may have been added since.
  createAncestors() {
    console.log('Creating ancestors for all entries');
    this.#persons.forEach((person) => {
      person.clearAncestors();
    });
    this.#persons.forEach((person) => {
      person.addAncestors(this);
    });
  }
}

export { Person, Database };
