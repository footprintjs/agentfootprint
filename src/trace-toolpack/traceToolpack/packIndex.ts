import type { CommitBundle, HonestyCode } from 'foottrace';
import type { StageSnapshot } from 'footprintjs/advanced';
import { executionStages } from '../../lib/executionStages.js';
import type { TraceToolpackArtifacts } from '../types.js';
import { WITHOUT_SUBFLOW_DOOR } from './artifactFacts.js';
import { subflowResultsOf, homeMountOf } from '../subflowRecords.js';

// ── Internal index over the artifacts (built once per factory call) ───────

interface StageGroup {
  /** The stage part of the runtimeStageId (path-prefixed stageId). */
  stagePart: string;
  ids: string[];
  name?: string;
  description?: string;
  isDecider: boolean;
  isSubflow: boolean;
  errorIds: string[];
}

interface ToolpackIndex {
  commitLog: CommitBundle[];
  /** runtimeStageId → first commit array index. */
  firstIdxOf: Map<string, number>;
  /** runtimeStageId → last commit array index (double-commits possible). */
  lastIdxOf: Map<string, number>;
  /** runtimeStageId → all bundles for that step. */
  bundlesOf: Map<string, CommitBundle[]>;
  /** runtimeStageId → execution-tree node (name/description/reads/errors). */
  nodes: Map<string, StageSnapshot>;
  /** Tree-walk order ≈ execution order; the id universe for navigation. */
  orderedIds: string[];
  /** stage part → ids, for unknown-id suggestions. */
  idsByStagePart: Map<string, string[]>;
  /** Every path the commit log ever wrote (engine DELIM form). */
  knownPaths: Set<string>;
  /** Distinct stages in first-execution order. */
  groups: StageGroup[];
  /** True when at least one step recorded tracked reads. */
  hasReadTracking: boolean;
  /** Steps with `$error` entries: where things went wrong. */
  errorSteps: { id: string; keys: string[] }[];
  /** Count of steps that consumed untracked sources (args/env/silent). */
  untrackedStepCount: number;
  /** The log's fold base (`RuntimeSnapshot.initialState`), for the value basis. */
  initialState: Record<string, unknown> | undefined;
  /**
   * Honesty codes whose full sentence this toolpack instance has already served — every
   * later mention is the bare `⚠ <code>` (the model has the sentence in context).
   */
  explained: Set<HonestyCode>;
  /** `snapshot.subflowResults` as a map — where every mount's OWN log is. */
  subflowResults: Record<string, unknown> | undefined;
  /** The mount whose own log holds an id this log does not (memoised; see `subflowRecords`). */
  homeMountOf: (id: string) => string | undefined;
  /**
   * False in a pack opened by `inspect_tool_run`: the model reaches it only
   * through that tool, which cannot route to `inspect_subflow`, so no hint may
   * name that door there (`WITHOUT_SUBFLOW_DOOR`).
   */
  subflowDoor: boolean;
}

function stagePartOf(runtimeStageId: string): string {
  const hash = runtimeStageId.lastIndexOf('#');
  return hash > 0 ? runtimeStageId.slice(0, hash) : runtimeStageId;
}

function buildIndex(artifacts: TraceToolpackArtifacts): ToolpackIndex {
  const commitLog = artifacts.snapshot.commitLog ?? [];
  const firstIdxOf = new Map<string, number>();
  const lastIdxOf = new Map<string, number>();
  const bundlesOf = new Map<string, CommitBundle[]>();
  const knownPaths = new Set<string>();
  let untrackedStepCount = 0;

  for (let i = 0; i < commitLog.length; i++) {
    const bundle = commitLog[i];
    const id = bundle.runtimeStageId;
    if (!firstIdxOf.has(id)) firstIdxOf.set(id, i);
    lastIdxOf.set(id, i);
    const list = bundlesOf.get(id);
    if (list) list.push(bundle);
    else {
      bundlesOf.set(id, [bundle]);
      if (bundle.untrackedSources && bundle.untrackedSources.length > 0) untrackedStepCount++;
    }
    for (const entry of bundle.trace) knownPaths.add(entry.path);
  }

  const subflowDoor = !WITHOUT_SUBFLOW_DOOR.has(artifacts);
  const subflowResults = subflowDoor ? subflowResultsOf(artifacts.snapshot) : undefined;
  const homes = new Map<string, string | undefined>();

  // Every stage in run order, from either tree form (lib/executionStages.ts).
  const nodes = new Map<string, StageSnapshot>();
  const orderedIds: string[] = [];
  const errorSteps: { id: string; keys: string[] }[] = [];
  let hasReadTracking = false;
  for (const stage of executionStages(artifacts.snapshot.executionTree)) {
    const node = stage as StageSnapshot;
    const id = node.runtimeStageId;
    if (id && !nodes.has(id)) {
      nodes.set(id, node);
      orderedIds.push(id);
      if (node.stageReads && Object.keys(node.stageReads).length > 0) hasReadTracking = true;
      const errorKeys = Object.keys(node.errors ?? {});
      if (errorKeys.length > 0) errorSteps.push({ id, keys: errorKeys });
    }
  }

  // Steps present in the commit log but missing from the tree. A subflow's own
  // log opens with its MOUNT's seed commit, which its tree does not hold — so
  // an id that committed before the tree's first step goes FIRST, not last.
  const treeFirstIdx = firstIdxOf.get(orderedIds[0] ?? '') ?? Infinity;
  const before: string[] = [];
  for (const id of bundlesOf.keys()) {
    if (nodes.has(id)) continue;
    if ((firstIdxOf.get(id) ?? Infinity) < treeFirstIdx) before.push(id);
    else orderedIds.push(id);
  }
  orderedIds.unshift(...before);

  const idsByStagePart = new Map<string, string[]>();
  const groupsByStagePart = new Map<string, StageGroup>();
  const groups: StageGroup[] = [];
  for (const id of orderedIds) {
    const stagePart = stagePartOf(id);
    const ids = idsByStagePart.get(stagePart);
    if (ids) ids.push(id);
    else idsByStagePart.set(stagePart, [id]);

    let group = groupsByStagePart.get(stagePart);
    if (!group) {
      group = { stagePart, ids: [], isDecider: false, isSubflow: false, errorIds: [] };
      groupsByStagePart.set(stagePart, group);
      groups.push(group);
    }
    group.ids.push(id);
    const node = nodes.get(id);
    if (node) {
      if (group.name === undefined && node.name !== undefined) group.name = node.name;
      if (group.description === undefined && node.description !== undefined) {
        group.description = node.description;
      }
      if (node.isDecider) group.isDecider = true;
      if (node.subflowId !== undefined) group.isSubflow = true;
      if (Object.keys(node.errors ?? {}).length > 0) group.errorIds.push(id);
    } else {
      const bundle = bundlesOf.get(id)?.[0];
      if (group.name === undefined && bundle) group.name = bundle.stage;
    }
  }

  return {
    commitLog,
    firstIdxOf,
    lastIdxOf,
    bundlesOf,
    nodes,
    orderedIds,
    idsByStagePart,
    knownPaths,
    groups,
    hasReadTracking,
    errorSteps,
    untrackedStepCount,
    initialState: artifacts.snapshot.initialState as Record<string, unknown> | undefined,
    explained: new Set<HonestyCode>(),
    subflowResults,
    subflowDoor,
    homeMountOf: (id) => {
      if (subflowResults === undefined) return undefined;
      if (!homes.has(id)) homes.set(id, homeMountOf(subflowResults, id));
      return homes.get(id);
    },
  };
}

/**
 * Commit-log anchor for "strictly before this step" lookups. Committed steps
 * anchor at their own first bundle. A step with no commit (defensive — every
 * executed stage normally records at least an empty bundle) anchors at the
 * next committed step in execution order.
 */
function anchorIdxFor(runtimeStageId: string, index: ToolpackIndex): number {
  const own = index.firstIdxOf.get(runtimeStageId);
  if (own !== undefined) return own;
  const position = index.orderedIds.indexOf(runtimeStageId);
  if (position >= 0) {
    for (let i = position + 1; i < index.orderedIds.length; i++) {
      const idx = index.firstIdxOf.get(index.orderedIds[i]);
      if (idx !== undefined) return idx;
    }
  }
  return index.commitLog.length;
}

export { stagePartOf, buildIndex, anchorIdxFor };
export type { ToolpackIndex };
