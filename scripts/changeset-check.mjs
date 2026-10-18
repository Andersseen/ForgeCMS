/** Whether a pull request changed files that require a Changesets entry. */
export function requiresChangeset(paths) {
  return paths.some((path) => path.startsWith('packages/'));
}
