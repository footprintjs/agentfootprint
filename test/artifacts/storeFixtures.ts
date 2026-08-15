/**
 * The fixtures the artifact-store test files share — scope tuples, a
 * controllable clock, and the factory type an adapter table is written in.
 *
 * THE LAWS THAT USED TO LIVE HERE HAVE MOVED. This file held `contractSuite`:
 * one definition of the five-verb contract, run against all five adapters —
 * good work, and shipped to NOBODY, because `package.json` excludes
 * `dist/test` from the published package. Somebody implementing `ArtifactStore`
 * over their own backend could read the port but not run the checks the
 * in-tree stores are held to.
 *
 * So every law it held was restyled into `src/artifacts/conformance` (no test
 * framework anywhere in it — a case throws to fail) and is now run against all
 * five stores by `./store-conformance.test.ts`, which maps the old tests to the
 * new cases one for one in its header. Add a new shared law THERE; this file is
 * fixtures only.
 */

import type { ArtifactScope, ArtifactStore } from '../../src/index.js';

export const SCOPE: ArtifactScope = { conversationId: 'conv-a' };
/** The neighbouring scope, for an adapter-specific test that needs a second
 *  one. The isolation LAWS live in the exported battery, which mints its own
 *  scopes per case. */
export const OTHER_SCOPE: ArtifactScope = { conversationId: 'conv-b' };

/** A controllable clock every adapter accepts through its test seam. */
export const clock = () => {
  let at = 1_000_000;
  return { now: () => at, tick: (ms: number) => (at += ms) };
};

/** How an adapter table builds the store under test, with time injected. */
export type MakeStore = (now: () => number) => ArtifactStore;
