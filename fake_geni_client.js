// A fake GeniClient holding a small family in memory, for testing code
// that fetches from Geni. Profiles get the id 'profile-<n>' and the guid
// 'g<n>'; unions the id 'union-<n>'. Answers are copies, shaped like
// Geni's, and come asynchronously. Like GeniClient's requests, profile
// answers hold only the fields in profileFields. Every request is logged
// in requests.

import { idToUrl, urlToId, profileFields } from './geni_structures.js';

// The fields of a profile record asked for with fields=.
function onlyProfileFields(record = {}) {
  return Object.fromEntries(
    Object.entries(record).filter(([field]) => profileFields.includes(field)),
  );
}

class FakeGeniClient {
  // Map of profile id -> profile record.
  #profiles = new Map();
  // Map of union id -> union record.
  #unions = new Map();
  #stopped = false;
  // Union ids whose fetch fails, as when Geni gives an error.
  failingUnions = new Set();
  // Requests made, as [operation, argument].
  requests = [];
  connected = true;

  // Add the profile number n. attributes are added to the record.
  person(n, name, gender, birthYear, attributes = {}) {
    const record = {
      id: `profile-${n}`,
      guid: `g${n}`,
      name,
      gender,
      unions: [],
      ...attributes,
    };
    if (birthYear !== undefined) {
      record.birth = { date: { year: birthYear } };
    }
    this.#profiles.set(record.id, record);
    return record;
  }

  // Add the union number n of the partners, with children, given as
  // profile numbers, and list it in their profiles.
  union(n, partners, children = []) {
    const id = `union-${n}`;
    this.#unions.set(id, {
      id,
      partners: partners.map((p) => idToUrl(`profile-${p}`)),
      children: children.map((c) => idToUrl(`profile-${c}`)),
    });
    for (const p of [...partners, ...children]) {
      this.#profiles.get(`profile-${p}`).unions.push(idToUrl(id));
    }
  }

  // Change a field of profile n, as when it is edited on Geni.
  // An undefined value removes the field.
  edit(n, field, value) {
    const record = this.#profiles.get(`profile-${n}`);
    if (value === undefined) {
      delete record[field];
    } else {
      record[field] = value;
    }
  }

  // Merge profile n into profile m: n is then answered with merged_into,
  // and its unions are moved to m.
  merge(n, m) {
    const [oldUrl, newUrl] = [idToUrl(`profile-${n}`), idToUrl(`profile-${m}`)];
    for (const union of this.#unions.values()) {
      union.partners = union.partners.map((p) => (p === oldUrl ? newUrl : p));
      union.children = union.children.map((c) => (c === oldUrl ? newUrl : c));
    }
    const target = this.#profiles.get(`profile-${m}`);
    target.unions = [
      ...new Set([
        ...target.unions,
        ...this.#profiles.get(`profile-${n}`).unions,
      ]),
    ];
    this.#profiles.set(`profile-${n}`, {
      id: `profile-${n}`,
      merged_into: idToUrl(`profile-${m}`),
    });
  }

  // How many times the profile with the guid was fetched, by guid or URL.
  profileFetches(guid) {
    const id = `profile-${guid.slice(1)}`;
    return this.requests.filter(
      ([operation, arg]) =>
        (operation === 'getPerson' && arg === guid) ||
        (operation === 'getPersonByUrl' && urlToId(arg) === id),
    ).length;
  }

  #answer(operation, arg, answer) {
    this.requests.push([operation, arg]);
    if (this.#stopped) {
      return Promise.reject(new Error('Fetching stopped'));
    }
    return Promise.resolve(answer()).then((value) => structuredClone(value));
  }

  // Unknown profiles are answered with an empty object.
  getPerson(guid) {
    return this.#answer('getPerson', guid, () =>
      onlyProfileFields(this.#profiles.get(`profile-${guid.slice(1)}`)),
    );
  }

  getPersonByUrl(url) {
    return this.#answer('getPersonByUrl', url, () =>
      onlyProfileFields(this.#profiles.get(urlToId(url))),
    );
  }

  // Like Geni, a single union is answered without a results list.
  getUnions(ids) {
    return this.#answer('getUnions', ids, () => {
      if (ids.some((id) => this.failingUnions.has(`union-${id}`))) {
        throw new Error('Union fetch failed');
      }
      const results = ids
        .map((id) => this.#unions.get(`union-${id}`))
        .filter(Boolean);
      return results.length === 1 ? results[0] : { results };
    });
  }

  stop() {
    this.#stopped = true;
  }

  start() {
    this.#stopped = false;
  }

  get stopped() {
    return this.#stopped;
  }
}

export { FakeGeniClient };
