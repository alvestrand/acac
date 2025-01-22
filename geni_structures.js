// This file contains functions that require understanding of the way
// Geni structures data, but do not

export { urlToId, idToUrl, resolveParents }

function urlToId(url) {
  return url.replace('https://www.geni.com/api/', '');
}

function idToUrl(id) {
  return 'https://www.geni.com/api/' + id;
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
