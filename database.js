// Class declarations for operating a database of person records.

class Person {
  // The identifier used for this person in Geni. String.
  #id;
  // A person record, fetched from Geni. Or a set of attributes generated for testing.
  #personRecord;
  // Ancestors, derived from Geni lookups. Set of string.
  #ancestors;
  // ID of father and mother entry
  #father;
  #mother;
  // Birth year
  #birthYear;
  // 'male' or 'female'
  #gender;

  constructor(id, attributes) {
    this.#id = id;
    this.#personRecord = attributes;
    if (attributes) {
      if ('father' in attributes) {
        this.#father = attributes.father;
      }
      if ('mother' in attributes) {
        this.#mother = attributes.mother;
      }
      if ('birth' in attributes) {
        this.#birthYear = attributes.birth;
      }
      if ('gender' in attributes) {
        this.#gender = attributes.gender;
      }
    }
    // For testing: Markers. This is a public attribute.
    this.markers = new Set();
  }

  toJSON() {
    return {id: this.#id, attributes: this.#personRecord, markers: this.markers};
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
  // Build the set of all ancestors from the supplied database.
  // If it's already built, do nothing.
  addAncestors(db) {
    if (!this.#ancestors) {
      let father = db.get(this.#father);
      let mother = db.get(this.#mother);
      if (father) {
        father.addAncestors();
      }
      if (mother) {
        mother.addAncestors();
      }
      this.#ancestors = new Set();
      if (father) {
        this.#ancestors = this.#ancestors.union(father.#ancestors);
        this.#ancestors.add(father.id());
      }
      if (mother) {
        this.#ancestors = this.#ancestors.union(mother.#ancestors);
        this.#ancestors.add(mother.id());
      }
    }
  }
  ancestors() {
    return this.#ancestors;
  }
}

class Database {
  // Person records. map of id -> Person.
  #persons;
  constructor() {
    this.#persons = new Map();
  }
  size() {
    return this.#persons.size;
  }
  clear() {
    this.#persons.clear();
  }
  addPerson(person) {
    this.#persons.set(person.id(), person);
  }
  addWithAttributes(id, attributes) {
    let newPerson = new Person(id, attributes);
    this.addPerson(newPerson);
  }
  get(id) {
    return this.#persons.get(id);
  }
  // Represent the database as a JSON string representation.
  toJsonString() {
    const obj = Object.fromEntries(this.#persons);
    return JSON.stringify({persons: obj}, null, 2);
  }
  // Initialize the database from a string representing a JSON object
  fromJsonString(data) {
    const parsed = JSON.parse(data);
    this.#persons = new Map(Object.entries(parsed.persons));
  }
  // For debugging: Return all records with a specific birth year
  getAllWithBirthYearAndGender(year, gender) {
    let result = [];
    this.#persons.forEach((value, key, map) => {
      if (value.birth() === year && (gender === 'all' || value.gender() == gender)) {
        result.push(value);
      }
    });
    return result;
  }
  createAncestors() {
    console.log('Creating ancestors for all entries that don\'t have it');
    this.#persons.forEach(person => {
      person.addAncestors(this);
    });
  }
}

export {
  Person,
  Database
}
