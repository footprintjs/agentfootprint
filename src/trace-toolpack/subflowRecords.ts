/**
 * subflowRecords — where a subflow mount's OWN log is, read through the
 * library's door.
 *
 * Pattern: pure lookups over `RuntimeSnapshot.subflowResults`.
 * Role:    what `inspect_subflow` opens, and what every outer tool asks when
 *          it is handed an id it does not know. Nothing here formats an
 *          answer beyond the absence reasons, which belong to the record.
 *
 * WHY THE MAP, AND WHY `getSubtreeSnapshot`. A subflow runs in an isolated
 * runtime and commits to its own log; the run's `commitLog` holds only the
 * mount boundary (seed in, merge-back out). footprintjs keeps each mount's log
 * in `subflowResults`, DUAL-KEYED — the subflow path (latest iteration) and
 * each mount's `runtimeStageId` (`sf-tools#11`) — and nested mounts are
 * merged UP into the same flat map (`sf-a/sf-b#7`). `getSubtreeSnapshot` is
 * the library's public door to one entry (history, fold base, tree, state);
 * this module only decides WHICH entry, and says why when there is none.
 *
 * Mounts are addressed by `runtimeStageId`, never by path: a mount inside a
 * loop runs several times, and the path key names only the last one.
 */

import { getSubtreeSnapshot } from 'footprintjs';
import type { RuntimeSnapshot } from 'footprintjs';

/** The subflow results map, when the snapshot carries one as a map. */
export function subflowResultsOf(snapshot: RuntimeSnapshot): Record<string, unknown> | undefined {
  const results = (snapshot as { subflowResults?: unknown }).subflowResults;
  return results !== null && typeof results === 'object' && !Array.isArray(results)
    ? (results as Record<string, unknown>)
    : undefined;
}

/** The inner history of one entry, when it carries one. */
function historyOf(entry: unknown): readonly { runtimeStageId?: unknown }[] | undefined {
  const tree = (entry as { treeContext?: { history?: unknown } } | undefined)?.treeContext;
  return Array.isArray(tree?.history)
    ? (tree.history as { runtimeStageId?: unknown }[])
    : undefined;
}

/**
 * The mount whose OWN log holds step `id` — the one level directly above it.
 *
 * Only per-mount keys (`…#n`) are asked: a path key is an alias of its last
 * iteration, and asking it would name the wrong iteration. The mount's own id
 * is excluded — a subflow's log opens with its mount's seed commit, so every
 * mount id is ALSO in the log one level down.
 */
export function homeMountOf(results: Record<string, unknown>, id: string): string | undefined {
  for (const [key, entry] of Object.entries(results)) {
    if (key === id || !key.includes('#')) continue;
    if (historyOf(entry)?.some((bundle) => bundle.runtimeStageId === id)) return key;
  }
  return undefined;
}

/**
 * The chain of mounts from the outer run down to `mount` — outermost first,
 * `mount` last — so a nested subflow is opened one level at a time. Undefined
 * when no chain reaches a step of the outer run (`isOuterStep`).
 */
export function mountChain(
  results: Record<string, unknown>,
  mount: string,
  isOuterStep: (id: string) => boolean,
): string[] | undefined {
  const chain = [mount];
  // Depth is bounded by the map itself: each hop names a different key.
  for (let hops = 0; hops <= Object.keys(results).length; hops++) {
    const top = chain[0] as string;
    if (isOuterStep(top)) return chain;
    const parent = homeMountOf(results, top);
    if (parent === undefined || chain.includes(parent)) return undefined;
    chain.unshift(parent);
  }
  return undefined;
}

/** Did this mount's own log write `path` (engine path form)? */
export function subflowWrote(entry: unknown, path: string): boolean {
  return (
    historyOf(entry)?.some((bundle) =>
      ((bundle as { trace?: { path?: unknown }[] }).trace ?? []).some((row) => row.path === path),
    ) ?? false
  );
}

/** Does `mount`'s own log open with the mount's seed commit (its own id first)? */
export function opensWithSeed(
  results: Record<string, unknown> | undefined,
  mount: string,
): boolean {
  return historyOf(results?.[mount])?.[0]?.runtimeStageId === mount;
}

/** Commits in `mount`'s own log (the mount's seed included); 0 when it kept none. */
export function innerCommitCount(
  results: Record<string, unknown> | undefined,
  mount: string,
): number {
  return historyOf(results?.[mount])?.length ?? 0;
}

/**
 * Open `mount`'s own record — or say, in the record's terms, why it cannot be.
 *
 * The inner snapshot is the subflow's own: its history as the commit log, its
 * OWN fold base (`treeContext.initialState`, normally `{}` — the seed is a
 * commit), its tree, and its served state (under `getSnapshot({ redact: true
 * })` the nested mirror, so the redacted view stays redacted). It keeps the
 * whole flat results map, so a mount nested inside it opens the same way.
 */
export function openSubflow(snapshot: RuntimeSnapshot, mount: string): RuntimeSnapshot | string {
  const results = subflowResultsOf(snapshot);
  if (results === undefined) {
    return (
      `this snapshot carries no subflow results, so no subflow's own log is here — the record ` +
      `was saved or served without them (a stripped recording or a trimmed view). What the run ` +
      `holds of '${mount}' is its boundary in the run's own log: trace_node('${mount}').`
    );
  }
  if (!(mount in results)) {
    return (
      `no subflow result was kept for mount '${mount}'. A mount gets one when its subflow ` +
      `returns: a lazy mount that never ran, or a subflow that failed or paused before it ` +
      `returned, leaves none — the record does not say which. Its boundary in the run's own ` +
      `log is all there is: trace_node('${mount}').`
    );
  }
  if (historyOf(results[mount]) === undefined) {
    return (
      `the subflow result for mount '${mount}' carries no inner log — it was kept without its ` +
      `history (a pause checkpoint keeps subflow results lean). Its boundary in the run's own ` +
      `log is all there is: trace_node('${mount}').`
    );
  }
  const subtree = getSubtreeSnapshot(snapshot, mount);
  const history = (subtree?.history ?? []) as RuntimeSnapshot['commitLog'];
  return {
    commitLog: history,
    executionTree: subtree?.executionTree,
    sharedState: subtree?.sharedState ?? {},
    initialState: subtree?.initialState,
    subflowResults: results,
    // A dial propagates into every subflow, so the encoding is the run's.
    commitValues: snapshot.commitValues,
  } as unknown as RuntimeSnapshot;
}
