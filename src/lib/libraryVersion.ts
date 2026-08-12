/**
 * libraryVersion — "which version of this library produced that?"
 *
 * Anything that ships a record of a run out of the process — an audit chain, a
 * bug-report bundle — has to stamp the library version on it, or the person
 * reading it months later is comparing behaviour against a version they are
 * guessing at. That is one job, so it is one function: two copies of this walk
 * would be two answers to a question that must have exactly one.
 *
 * It reads the package manifest through `lazyRequire`, trying the installed
 * specifier first and then the relative paths that work from `dist/` and from
 * `dist/esm/`. The `name` guard rejects any manifest that is not ours — a
 * relative walk in a consumer's tree can otherwise find THEIR package.json and
 * stamp a record with the application's version.
 *
 * Never throws, and answers `'unknown'` when it cannot tell. A version that
 * cannot be read is a stamp that says so; a thrown error here would take down
 * the export that merely wanted to label itself.
 */

import { lazyRequire } from './lazyRequire.js';

function versionOf(packageName: string, candidates: readonly string[]): string {
  for (const specifier of candidates) {
    try {
      const pkg = lazyRequire<{ name?: string; version?: string }>(specifier);
      if (pkg.name === packageName && typeof pkg.version === 'string') return pkg.version;
    } catch {
      /* try the next candidate */
    }
  }
  return 'unknown';
}

/** This library's own version, or `'unknown'`. */
export function libraryVersion(): string {
  return versionOf('agentfootprint', [
    'agentfootprint/package.json',
    '../../package.json',
    '../../../package.json',
  ]);
}

/** The engine underneath, or `'unknown'` — the other half of "which versions?". */
export function engineVersion(): string {
  return versionOf('footprintjs', ['footprintjs/package.json']);
}
