// Building ancestor trees from Geni: fetching profiles, unions and
// parents, following merges, and rebuilding trees to pick up changes.
// The Geni client and the database are passed in, so that this can be
// tested with a fake client; index.js does the page side.

import {
  urlToId,
  idToUrl,
  resolveParents,
  pathLength,
} from './geni_structures.js';

// Profiles merged on Geni are answered with a merged_into pointer to the
// profile they were merged into, which may itself have been merged.
const maxMergeSteps = 5;

function profileBirthYear(profile) {
  const year = profile.birth?.date?.year;
  return year === undefined ? undefined : Number(year);
}

class TreeBuilder {
  #client;
  #db;
  #hooks;

  // Rebuilding fetches profiles and their parents again, even if they are
  // already in the database, to pick up changes on Geni. All rebuilds
  // share one pool of profiles waiting to be refreshed, worked through by
  // a single #runRefreshPool, so that an ancestor shared by several
  // profiles being rebuilt at the same time is only refreshed once.

  // Profiles waiting to be refreshed: map of guid -> {birthYearAssumption,
  // yearLimit}. Refreshed in the order added, one generation after another.
  #refreshPool = new Map();
  // Guids refreshed since the pool was last empty. They are not refreshed
  // again until the pool has been completely emptied.
  #refreshedGuids = new Set();
  // Guids whose profiles were fetched since the pool was last empty
  // (see #refreshPerson). Emptied together with #refreshedGuids.
  #fetchedGuids = new Set();
  // The running #runRefreshPool, or undefined.
  #refreshRun;

  // client is a GeniClient (or a fake one), db the Database. hooks:
  // - onSurprise(kind, details, answer): an answer from Geni did not match
  //   what the code expects. Fetching is stopped after this is called.
  // - onMerge(oldId, newId): oldId was found to be merged into newId on
  //   Geni, and the merge has been recorded in the database.
  // - onMessage(text): a message to show to the user.
  // - name(person): the person's name as shown on the page, for details
  //   in surprises.
  constructor(client, db, hooks = {}) {
    this.#client = client;
    this.#db = db;
    this.#hooks = {
      onSurprise: () => {},
      onMerge: () => {},
      onMessage: () => {},
      name: (person) => person.name(),
      ...hooks,
    };
  }

  // Some assumptions about Geni's answers have not been checked yet. If
  // one turns out to be wrong, report it and stop fetching, so that it
  // can be looked into before more of the database is changed.
  #surprise(kind, details, answer) {
    console.log('Unexpected Geni answer:', kind, details, answer);
    this.#hooks.onSurprise(kind, details, answer);
    this.#client.stop();
  }

  // The person's name and guid, for details in surprises.
  #describe(person) {
    return `${this.#hooks.name(person)} (${person.id()})`;
  }

  // Follow merged_into pointers from a fetched profile to the current one.
  async #followMerges(profile) {
    const first = profile;
    for (let i = 0; i < maxMergeSteps && 'merged_into' in profile; i++) {
      console.log('Following merged-to pointer', profile.merged_into);
      if (
        typeof profile.merged_into !== 'string' ||
        !profile.merged_into.startsWith(idToUrl(''))
      ) {
        this.#surprise(
          'merged_into is not a profile API URL',
          String(profile.merged_into),
          profile,
        );
        return profile;
      }
      profile = await this.#client.getPersonByUrl(profile.merged_into);
    }
    if ('merged_into' in profile) {
      this.#surprise(
        `more than ${maxMergeSteps} merges in a row`,
        String(first.guid ?? first.id),
        first,
      );
    } else if (Object.keys(profile).length > 0 && !('name' in profile)) {
      // Profiles are fetched with fields=, and it is not known whether
      // Geni still answers merged_into then. A merged profile answered
      // without it would look like this. Treat it as not found, so that
      // it is not stored. (An empty answer means not found.)
      this.#surprise(
        'a profile has neither name nor merged_into',
        String(profile.guid ?? profile.id),
        profile,
      );
      return {};
    } else if (profile !== first && !('guid' in profile)) {
      this.#surprise(
        'the profile merged into has no guid',
        String(first.merged_into),
        profile,
      );
    }
    return profile;
  }

  // Fetch a profile by guid, following merges.
  async #fetchProfile(guid) {
    const profile = await this.#client.getPerson(guid);
    if (
      'guid' in profile &&
      profile.guid !== guid &&
      !('merged_into' in profile)
    ) {
      // Treated as a merge, but Geni was expected to say merged_into.
      this.#surprise(
        'asked for one guid, got another without merged_into',
        `Asked for ${guid}, got ${profile.guid}`,
      );
    }
    return this.#followMerges(profile);
  }

  // Add a fetched profile to the database, unless it is there already.
  // If it was fetched for the person oldId and has another guid, oldId was
  // merged into it: record the merge, which moves the links to it.
  // Returns the person.
  #storeProfile(profile, oldId) {
    const person =
      this.#db.get(profile.guid) ??
      this.#db.addWithAttributes(profile.guid, profile);
    if (oldId !== undefined && oldId !== profile.guid) {
      const changed = this.#db.merge(oldId, profile.guid);
      console.log(
        oldId,
        'was merged into',
        person.name(),
        '- changed links of',
        changed,
        'persons',
      );
      this.#hooks.onMerge(oldId, profile.guid);
    }
    return person;
  }

  // Fetch the profile with the guid typed into the "Add profile" field,
  // unless it is in the database already and not known to be merged.
  // Follows merges. Returns the person, or undefined if no profile was
  // found.
  async fetchProfileToAdd(guid) {
    const stored = this.#db.get(guid);
    const mergedTo = stored?.attribute('merged_into');
    if (stored && mergedTo === undefined) {
      return stored;
    }
    const profile =
      mergedTo === undefined
        ? await this.#fetchProfile(guid)
        : await this.#followMerges(await this.#client.getPersonByUrl(mergedTo));
    if (!('guid' in profile)) {
      console.log('No guid, no profile?');
      return undefined;
    }
    return this.#storeProfile(profile, stored?.id());
  }

  // Add profiles from a Geni path if they meet the birth-year limit, and
  // fetch their parent links. Path relations identify profiles, but
  // unions define parents.
  async addPathProfiles(relations, birthYearLimit = 1600) {
    const startingSize = this.#db.size();
    const discarded = new Set();
    for (const relation of relations) {
      if (this.#client.stopped) {
        break;
      }
      if (!relation.url || !relation.url.startsWith(idToUrl(''))) {
        console.log('Path relation has no profile API URL', relation);
        continue;
      }
      const person =
        this.#db.getByIdAttribute(urlToId(relation.url)) ??
        (await this.#addProfileByUrl(relation.url, birthYearLimit, (url) =>
          discarded.add(urlToId(url)),
        ));
      if (person) {
        // One generation ensures this profile's unions and parent records
        // are loaded, without recursively expanding the tree.
        await this.buildTreeForPerson(
          person,
          2025,
          -Infinity,
          1,
          birthYearLimit,
          (url) => discarded.add(urlToId(url)),
        );
      }
    }
    return {
      added: Math.max(0, this.#db.size() - startingSize),
      discarded: [...discarded],
    };
  }

  // Find paths from one profile to each target, discard paths over the
  // configured limit, and add eligible profiles from the remaining paths.
  // onProgress is a page hook; it receives the target before its request.
  async findPathsToProfiles(
    person,
    targets,
    pathLengthLimit,
    birthYearLimit,
    onProgress = () => {},
  ) {
    let added = 0;
    let pathsDiscarded = 0;
    const profilesDiscarded = new Set();
    const statusCounts = {
      done: 0,
      pending: 0,
      overloaded: 0,
      'not found': 0,
      other: 0,
    };

    for (const target of targets) {
      if (this.#client.stopped) {
        break;
      }
      onProgress(target);
      const result = await this.#client.getPathTo(
        person.attribute('id'),
        target.attribute('id'),
        'blood',
      );
      const status = Object.hasOwn(statusCounts, result.status)
        ? result.status
        : 'other';
      statusCounts[status]++;
      if (result.status !== 'done' || !Array.isArray(result.relations)) {
        console.log('Path search did not finish', result);
        continue;
      }
      if (pathLength(result) > pathLengthLimit) {
        pathsDiscarded++;
        continue;
      }
      const pathResult = await this.addPathProfiles(
        result.relations,
        birthYearLimit,
      );
      added += pathResult.added;
      pathResult.discarded.forEach((id) => profilesDiscarded.add(id));
    }

    return {
      added,
      pathsDiscarded,
      profilesDiscarded: [...profilesDiscarded],
      statusCounts,
    };
  }

  // Fetch a profile by guid, following merges. Returns the person,
  // or undefined if no profile was found.
  async #fetchPersonByGuid(guid) {
    const profile = await this.#fetchProfile(guid);
    if (!('guid' in profile)) {
      console.log('No profile found for', guid);
      return undefined;
    }
    return this.#storeProfile(profile, guid);
  }

  // Fetch a profile by its API URL, following merges, and add it to the
  // database. Returns the person, or undefined if it could not be fetched.
  async #addProfileByUrl(
    url,
    birthYearLimit = -Infinity,
    onDiscard = () => {},
  ) {
    try {
      console.log('Adding profile ', url);
      const fetched = await this.#followMerges(
        await this.#client.getPersonByUrl(url),
      );
      if (!('guid' in fetched)) {
        console.log('No guid, no profile?');
        return;
      }
      const birthYear = profileBirthYear(fetched);
      if (birthYear !== undefined && birthYear < birthYearLimit) {
        onDiscard(url);
        return;
      }
      const person = this.#storeProfile(fetched);
      console.log('Added', person.name());
      return person;
    } catch (error) {
      console.log('AddProfileByUrl failed, message ', error);
      return;
    }
  }

  // Fetch the unions of person and set person.parents to the API URLs of
  // the parents in the birth union. Leaves it unchanged if the person has
  // no unions or the fetch fails.
  async #addParents(person) {
    let unions;
    if (!person.unions()) {
      console.log('No unions on ', person.id(), person.name());
      return;
    }
    if (person.parents && person.parents !== undefined) {
      console.log('Already have parents on', person.name());
    }
    // Trigger fetching of parents.
    const strippedUnions = person.unions().map((str) => {
      return str.split('-')[1];
    });
    try {
      const result = await this.#client.getUnions(strippedUnions);
      if ('results' in result) {
        unions = result.results;
      } else if ('id' in result) {
        // When a single result is returned, it's returned
        // without a containing "results" array.
        unions = [result];
      } else {
        console.log('No results in result', result);
        this.#hooks.onMessage('Finding unions gave empty result');
        return;
      }
    } catch (error) {
      console.log('Fetch unions failed, message ', error);
      return;
    }
    const parents = resolveParents(person, unions);
    // We don't know which parent is father at this point. Just store,
    // and resolve when we know more.
    person.parents = parents;
  }

  // Fetch the ancestors of person born in yearLimit or later. If
  // generations is given, stop after that many generations as well.
  // Profiles already in the database are not fetched again.
  async buildTreeForPerson(
    person,
    birthYearAssumption,
    yearLimit,
    generations = Infinity,
    profileBirthYearLimit = -Infinity,
    onProfileDiscard = () => {},
  ) {
    if (this.#client.stopped || generations <= 0) {
      return;
    }
    if (!person) {
      console.log('Error: Called with no person');
      return;
    }
    const birth = person.attribute('birth');
    let birthYear = birthYearAssumption;
    if (birth && 'date' in birth && 'year' in birth.date) {
      birthYear = birth.date.year + 0;
    }
    if (birthYear < yearLimit) {
      console.log(`${person.name()} seems born in ${birthYear} - not looking`);
      return;
    }
    if (person.parents === undefined) {
      await this.#addParents(person);
    }
    if (person.parents === undefined) {
      console.log('Could not fetch parents for ', person.name());
      return;
    }
    if (!person.father() || !person.mother()) {
      // Fill in person records for father and mother.
      const promises = person.parents.map(async (parentId) => {
        let parentPerson = this.#db.getByIdAttribute(urlToId(parentId));
        if (!parentPerson) {
          parentPerson = await this.#addProfileByUrl(
            parentId,
            profileBirthYearLimit,
            onProfileDiscard,
          );
        }
        if (!parentPerson) {
          console.log('Unable to fetch', parentId);
          return;
        }
        if (parentPerson.gender() == 'male') {
          person.setFather(parentPerson.id());
        } else {
          person.setMother(parentPerson.id());
        }
      });
      await Promise.all(promises);
    }
    if (person.father()) {
      let dbFather = this.#db.get(person.father());
      if (!dbFather) {
        // somehow ref to father got stored, but not father
        dbFather = await this.#fetchPersonByGuid(person.father());
      }
      await this.buildTreeForPerson(
        dbFather,
        birthYear - 30,
        yearLimit,
        generations - 1,
        profileBirthYearLimit,
        onProfileDiscard,
      );
    }
    if (person.mother()) {
      let dbMother = this.#db.get(person.mother());
      if (!dbMother) {
        // somehow ref to mother got stored, but not mother
        dbMother = await this.#fetchPersonByGuid(person.mother());
      }
      await this.buildTreeForPerson(
        dbMother,
        birthYear - 30,
        yearLimit,
        generations - 1,
        profileBirthYearLimit,
        onProfileDiscard,
      );
    }
  }

  // Fetch person and all ancestors back to yearLimit again, to pick up
  // changes and new parents on Geni. Resolves when the refresh pool is
  // empty, so if other rebuilds are running, when they are all done.
  rebuild(person, yearLimit) {
    this.#requestRefresh(person, 2025, yearLimit);
    this.#refreshRun ??= this.#runRefreshPool();
    return this.#refreshRun;
  }

  // Add person to the refresh pool, unless already refreshed. If it is
  // waiting already, keep the most generous limits of the two requests.
  #requestRefresh(person, birthYearAssumption, yearLimit) {
    const id = person.id();
    if (this.#refreshedGuids.has(id)) {
      return;
    }
    const waiting = this.#refreshPool.get(id);
    if (waiting) {
      birthYearAssumption = Math.max(
        birthYearAssumption,
        waiting.birthYearAssumption,
      );
      yearLimit = Math.min(yearLimit, waiting.yearLimit);
    }
    this.#refreshPool.set(id, { birthYearAssumption, yearLimit });
  }

  // Refresh the profiles in the pool until it is empty, adding the parents
  // of each one refreshed, back to the "back to" year limit. Profiles
  // beyond the limit are left out without being marked as refreshed, so
  // that a request with a lower limit can still refresh them.
  async #runRefreshPool() {
    // Let rebuild store this run in #refreshRun before anything else
    // happens. Otherwise, if the pool were finished without waiting for
    // Geni, the finally clause below would clear #refreshRun first, and
    // later rebuilds would wait for this finished run instead of
    // starting a new one.
    await null;
    try {
      while (this.#refreshPool.size > 0 && !this.#client.stopped) {
        const [id, { birthYearAssumption, yearLimit }] = this.#refreshPool
          .entries()
          .next().value;
        this.#refreshPool.delete(id);
        // The profile may have been merged into another since it was added.
        let person = this.#db.get(id);
        if (!person || this.#refreshedGuids.has(person.id())) {
          continue;
        }
        const birthYear = person.birth() ?? birthYearAssumption;
        if (birthYear < yearLimit) {
          continue;
        }
        this.#refreshedGuids.add(person.id());
        person = await this.#refreshPerson(person, this.#fetchedGuids);
        this.#refreshedGuids.add(person.id());
        for (const parentId of [person.father(), person.mother()]) {
          const parent = parentId && this.#db.get(parentId);
          if (parent) {
            this.#requestRefresh(parent, birthYear - 30, yearLimit);
          }
        }
      }
    } finally {
      // Stopped, failed or done: start afresh next time.
      this.#refreshPool.clear();
      this.#refreshedGuids.clear();
      this.#fetchedGuids.clear();
      this.#refreshRun = undefined;
    }
  }

  // Fetch person's profile from Geni again and replace the stored record
  // with it, unless it was fetched already in this round of refreshing.
  // fetched holds the guids of profiles fetched in this round; guids
  // fetched here are added to it. If the profile was merged into another,
  // the merge is recorded and the other person is returned. If the fetch
  // fails, the stored record is kept.
  async #refetchProfile(person, fetched) {
    if (fetched.has(person.id())) {
      return person;
    }
    let profile;
    try {
      profile = await this.#fetchProfile(person.id());
    } catch (error) {
      console.log('Refetching', person.name(), 'failed, message', error);
      return person;
    }
    if (!('guid' in profile)) {
      console.log(person.name(), 'not found, keeping it');
      return person;
    }
    if (profile.guid !== person.id()) {
      person = this.#storeProfile(profile, person.id());
      if (fetched.has(person.id())) {
        return person;
      }
    }
    this.#db.updateAttributes(person.id(), profile);
    fetched.add(person.id());
    return person;
  }

  // Fetch person's profile and parents from Geni again, and set the parent
  // links from the answer. If a fetch fails, the stored data is kept.
  // If the profile was merged into another, the merge is recorded and the
  // other person is refreshed instead. Returns the person refreshed.
  // fetched is as for #refetchProfile.
  async #refreshPerson(person, fetched) {
    person = await this.#refetchProfile(person, fetched);
    const oldParents = person.parents;
    const oldFather = person.father();
    const oldMother = person.mother();
    person.parents = undefined;
    if (person.unions()) {
      await this.#addParents(person);
    } else {
      // Without unions, Geni knows no parents. But every ancestor is in a
      // union with a partner, so this was not expected in a tree.
      this.#surprise(
        'a profile in a tree has no unions',
        this.#describe(person),
      );
      person.parents = [];
    }
    if (person.parents === undefined) {
      person.parents = oldParents;
      person.setFather(oldFather);
      person.setMother(oldMother);
      return person;
    }
    const parents = [];
    let failed = false;
    for (const parentUrl of person.parents) {
      let parent = this.#db.getByIdAttribute(urlToId(parentUrl));
      if (parent) {
        // The stored record may be out of date, for instance in gender,
        // so fetch it again before using it. When the parent's own turn
        // comes, it is not fetched again.
        parent = await this.#refetchProfile(parent, fetched);
      } else {
        parent = await this.#addProfileByUrl(parentUrl);
        if (parent) {
          fetched.add(parent.id());
        }
      }
      if (parent) {
        parents.push(parent);
      } else {
        console.log('Unable to fetch', parentUrl);
        failed = true;
      }
    }
    // The parents are fresh from Geni now, so a mismatch is in Geni's data
    // or in how the code reads it.
    const fathers = parents.filter((parent) => parent.gender() == 'male');
    const mothers = parents.filter((parent) => parent.gender() != 'male');
    if (fathers.length > 1 || mothers.length > 1) {
      this.#surprise(
        fathers.length > 1
          ? 'two fathers'
          : 'two mothers, or a parent with unknown gender',
        this.#describe(person),
        parents.map((parent) => ({
          name: parent.name(),
          id: parent.id(),
          gender: parent.gender(),
          fetched: fetched.has(parent.id()),
        })),
      );
    }
    const father = fathers.at(-1)?.id();
    const mother = mothers.at(-1)?.id();
    if (!failed && ((oldFather && !father) || (oldMother && !mother))) {
      // Parents can be removed on Geni, but this may also mean that
      // resolveParents missed them.
      this.#surprise(
        'known parents were not found again',
        this.#describe(person),
      );
    }
    // If a parent could not be fetched, keep the old link in its place.
    person.setFather(father ?? (failed ? oldFather : undefined));
    person.setMother(mother ?? (failed ? oldMother : undefined));
    return person;
  }
}

export { TreeBuilder };
