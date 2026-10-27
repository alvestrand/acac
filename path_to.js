export { pathLength };

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
