// This file contains functions that require understanding of the way
// Geni structures data, but do not

export {
  urlToId,
  idToUrl,
  isolateId,
  resolveParents,
  profileFields,
  pathLength,
};

// The profile fields the app uses, asked for with fields= so that Geni
// leaves out the rest (about, photos, locations and so on).
// merged_into is listed so that merges are still reported.
const profileFields = [
  'id',
  'guid',
  'name',
  'gender',
  'birth',
  'unions',
  'updated_at',
  'profile_url',
  'merged_into',
];

function urlToId(url) {
  return url.replace('https://www.geni.com/api/', '');
}

function idToUrl(id) {
  return 'https://www.geni.com/api/' + id;
}

// The last part of a profile URL or path, without any query: the guid
// or profile id typed or pasted into the "Add profile" field.
function isolateId(url) {
  const basepart = url.split('?')[0];
  const parts = basepart.split('/');
  return parts[parts.length - 1];
}

function resolveParents(profile, unionList) {
  const id = profile.attribute('id');
  const idAsUrl = idToUrl(id);
  for (const union of unionList) {
    let isChild = false;
    let isAdopted = false;
    let isFoster = false;
    if ('children' in union) {
      isChild = union.children.includes(idAsUrl);
    }
    if (isChild) {
      if ('adoped_children' in union) {
        isAdopted = union.adopted_children.includes(idAsUrl);
      }
      if ('foster_children' in union) {
        isFoster = union.foster_children.includes(idAsUrl);
      }
    }
    if (isChild && !isAdopted && !isFoster) {
      return union.partners;
    }
  }
  return [];
}

// Number of relationship steps in a path-to response. Geni's step_count
// is authoritative; relations includes both endpoints, so its fallback is
// one fewer than the number of entries.
function pathLength(result) {
  if (result.step_count !== undefined) {
    return Number(result.step_count);
  }
  return Array.isArray(result.relations)
    ? Math.max(0, result.relations.length - 1)
    : undefined;
}
