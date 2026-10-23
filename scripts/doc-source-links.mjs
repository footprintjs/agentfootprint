/** Dependency definitions are package paths, never links into this repository.
 * TypeDoc may resolve a shared node_modules symlink to an absolute worktree path.
 * Keep that machine path out of committed documentation in either checkout shape. */
export function normalizeDependencySources(markdown) {
  return markdown.replace(/^Defined in: (.+)$/gm, (line, source) => {
    const linked = /^\[([^\]]+)\]\([^)]+\)$/.exec(source);
    const label = linked?.[1] ?? source;
    const dependency = /(?:^|[/\\])(node\\?_modules[/\\].*)$/.exec(label);
    return dependency ? `Defined in: ${dependency[1]}` : line;
  });
}
