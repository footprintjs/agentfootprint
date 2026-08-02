/**
 * variable-recall — footprintjs's VARIABLE slices, joined to agent vocabulary.
 *
 * footprintjs answers "what happened to this variable?" in the address space it
 * owns: commit indices, runtimeStageIds, state keys (`keyTimeline` /
 * `forwardSliceForKey`, `footprintjs/trace`). An agent debugger asks the same
 * question in a DIFFERENT vocabulary: which LOOP was that, which injected fact
 * or tool result is that write, and what would REMOVING it cost. This module is
 * the join between the two — and nothing more:
 *
 *   - **Pure assembly.** Every fact here was already recorded. No new capture,
 *     no new scorer, no embedder, no LLM. `joinVariableSlice` re-labels; it
 *     never measures.
 *   - **Loop lifting.** Each moment gets the `loopIndex` of the frame that
 *     contains its `runtimeStageId` (the walk's own `buildWriterFrameIndex` —
 *     one resolver, not two).
 *   - **Agent identity.** A WRITE whose value the trajectory carries is run
 *     through the SAME `defaultSuspectClassifier` the localizer uses, so a
 *     write joins 1:1 with a `Suspect` (`injectionId` / `toolName`) and gets
 *     the `AblationSpec` that would remove it. Writers the classifier cannot
 *     name get NO hook — an honest absence, never a fabricated one.
 *   - **Honesty rides along verbatim.** footprintjs's `HonestyNote`s, the
 *     missing-reason, and `readsCoverage` are copied, not re-worded.
 *
 * The one JUDGEMENT this module makes is {@link DataflowCoverage} — see the
 * long comment on `dataflowCoverage()`. It is what lets `walkToRoot` replace a
 * text-similarity guess with a recorded dataflow edge, and it is deliberately
 * strict.
 *
 * @beta Beta feature (RFC-003 Part B). The API works and is tested, but may
 * change before GA.
 */

import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import {
  forwardSliceForKey,
  keyTimeline,
  keysReadFromExecutionTree,
  keysReadFromMap,
} from 'footprintjs/trace';
import type {
  ForwardEdge,
  ForwardNode,
  ForwardSlice,
  HonestyNote,
  KeyMoment,
  KeyTimeline,
  MissingSliceReason,
  ReadsCoverage,
  StateKey,
} from 'footprintjs/trace';

import { ablationForSuspect } from './ablation.js';
import {
  defaultSuspectClassifier,
  type ClassifyContext,
  type SuspectClassifier,
} from './localize.js';
import { assembleTrajectory, type Trajectory } from './trajectory.js';
import type { AblationSpec, ContextBugArtifacts, SuspectKind } from './types.js';
import { buildWriterFrameIndex } from './walk-to-root.js';

// ─── Types ───────────────────────────────────────────────────────────

/**
 * How exactly this log records what a key's value FED — the one judgement in
 * this module, and the gate on `walkToRoot`'s deterministic hop.
 *
 * - `'exact'` — every recorded `fed` edge for this key carries per-write
 *   provenance (`FedBasis: 'per-write'`, the `writeProvenance: 'reads-prefix'`
 *   dial): a downstream write is linked to this value BECAUSE that write's
 *   recorded read-prefix names the key, and a write whose prefix omits it is
 *   excluded exactly.
 * - `'conservative'` — at least one edge is stage-level co-occurrence
 *   (`'conservative-fed-edges'`), or the log carries no recorded reads at all.
 *   Sound over-approximation; NEVER presented as exact.
 * - `'unknown'` — no forward slice was supplied, OR the key has no recorded
 *   `fed` edge at all. The second case is the trap: with zero edges there is
 *   also zero conservative edge, so "no conservative edges" would be VACUOUSLY
 *   true and a key nothing ever read would masquerade as the most exact key in
 *   the run. It is demoted here instead.
 */
export type DataflowCoverage = 'exact' | 'conservative' | 'unknown';

/**
 * One moment in a key's life ({@link KeyMoment}), lifted into agent vocabulary.
 * The footprintjs fields are carried through UNCHANGED — this type only ADDS.
 */
export interface AgentKeyMoment {
  readonly kind: 'write' | 'read';
  /** Commit ARRAY position — the write's own, or the READING stage's. */
  readonly commitIdx: number;
  readonly runtimeStageId: string;
  readonly stageId: string;
  readonly stageName: string;
  /** `'write'` moments only: the trace verb. */
  readonly verb?: KeyMoment['verb'];
  /** `'read'` moments only: the commitIdx of the write whose value it saw. */
  readonly fromWriteIdx?: number;
  /**
   * The ReAct loop this moment happened in. ABSENT when the step is not in any
   * frame (run prelude, root-seeded setup) — absence is information, not a gap.
   */
  readonly loopIndex?: number;
  /**
   * `'write'` moments the classifier recognized: what KIND of agent source this
   * write produced. When one write produced several sources (an injection slot
   * commits an array of records), this is the FIRST one's kind and
   * {@link AgentVariableSlice.ablations} carries them all.
   */
  readonly suspectKind?: SuspectKind;
  /** The suspect identity (`injectionId` / `toolName`) — joins a `Suspect` 1:1. */
  readonly suspectId?: string;
}

/**
 * The counterfactual attached to one classifiable WRITE: "to test this write,
 * re-run without this source". A HOOK, not a verdict — running it is the
 * consumer's `AblationRunner` (§B2: only ablation verdicts are causal claims).
 */
export interface VariableAblationHook {
  /** runtimeStageId of the write that introduced the source. */
  readonly writerId: string;
  /** `injectionId` / `toolName` — the localizer's suspect identity. */
  readonly suspectId: string;
  readonly kind: SuspectKind;
  /** What to remove for the counterfactual re-run. */
  readonly spec: AblationSpec;
}

/**
 * One variable's recorded life, in agent vocabulary — the artifact BOTH a human
 * board ({@link variableToBacktrackTrace}) and the walk read.
 *
 * JSON-safe by construction (flat moments, no graph, no live references): the
 * same object can be persisted, sent over the wire, or handed to an LLM tool.
 */
export interface AgentVariableSlice {
  /** The state key asked about (footprintjs's normalised string form). */
  readonly key: string;
  /** Writes and reads in commit order. EMPTY when `missing`. */
  readonly moments: readonly AgentKeyMoment[];
  /** Present ONLY when there are no moments — footprintjs's honest absence. */
  readonly missing?: MissingSliceReason;
  /** How exactly this log records what the value fed — see {@link DataflowCoverage}. */
  readonly coverage: DataflowCoverage;
  /** One per classifiable write — see {@link VariableAblationHook}. */
  readonly ablations: readonly VariableAblationHook[];
  /** footprintjs's honesty notes, VERBATIM (both doors' notes, de-duplicated). */
  readonly notes: readonly HonestyNote[];
  /** Which `KeysReadSource` strategy resolved reads (honesty/debug). */
  readonly keysReadKind: string;
  /** Reads telemetry — `stepsWithReads === 0` means reads were not recorded. */
  readonly readsCoverage?: ReadsCoverage;
}

export interface JoinVariableSliceOptions {
  /**
   * The FORWARD slice of the same key (`forwardSliceForKey`) — the ONLY carrier
   * of per-edge exactness (`ForwardEdge.basis`). Without it `coverage` is
   * `'unknown'` and the walk will not take a dataflow hop.
   */
  readonly forward?: ForwardSlice;
  /** Override the suspect classifier (default `defaultSuspectClassifier`). */
  readonly classify?: SuspectClassifier;
}

export interface TraceVariableOptions extends JoinVariableSliceOptions {
  /** Reuse an already-assembled trajectory (avoids re-slicing the run). */
  readonly trajectory?: Trajectory;
  /** Exclusive commit-array-index bound — the variable as it stood BEFORE this idx. */
  readonly before?: number;
}

// ─── Coverage ────────────────────────────────────────────────────────

/** Walk a forward slice's DAG once, collecting the distinct edge bases. */
function fedBases(root: ForwardNode | undefined): Set<ForwardEdge['basis']> {
  const bases = new Set<ForwardEdge['basis']>();
  if (root === undefined) return bases;
  const seen = new Set<ForwardNode>();
  const queue: ForwardNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const edge of node.fedEdges) {
      bases.add(edge.basis);
      queue.push(edge.child);
    }
  }
  return bases;
}

/**
 * The coverage verdict (see {@link DataflowCoverage} for the three values).
 *
 * WHY the vacuous case is demoted: `'exact'` requires POSITIVE evidence — at
 * least one `'per-write'` edge — not merely the absence of a conservative one.
 * A key with no recorded reader (the agent's `lastToolResult`: written by
 * tool-calls, never read back by `call-llm`) has an EMPTY edge set, so "no
 * conservative edges" is vacuously true; scoring that as exact would hand the
 * walk its most confident hop on its least-evidenced key. Absence of dataflow
 * is `'unknown'`, never exactness.
 *
 * WHY this is stricter than the single hop needs: the hop the walk actually
 * takes rests on `KeyMoment.fromWriteIdx` — read→value attribution, which the
 * commit log records INDEPENDENTLY of the write-provenance dial and is exact on
 * its own. Requiring per-write fed-edge exactness on top of that is a
 * conservative CHOICE, made so the deterministic narrow ships behind the
 * strongest available evidence; a later wave can relax it with measurements
 * rather than having to re-derive why it was strict.
 */
function dataflowCoverage(forward: ForwardSlice | undefined): DataflowCoverage {
  if (forward === undefined) return 'unknown';
  if (forward.notes.some((n) => n.code === 'reads-not-recorded')) return 'conservative';
  const bases = fedBases(forward.root);
  if (bases.size === 0) return 'unknown'; // vacuous — see above
  return bases.has('stage') ? 'conservative' : 'exact';
}

// ─── The join ────────────────────────────────────────────────────────

/** Identity of one committed value the trajectory carries: (state key, writer). */
function valueKey(key: string, writerId: string): string {
  return `${key} ${writerId}`;
}

/**
 * Every committed value the trajectory materialized, indexed by (key, writer).
 * These are `commitValueAt` results — already redaction-scrubbed, already
 * verb-folded — so classification needs no second pass over the commit log.
 */
function buildValueIndex(trajectory: Trajectory): Map<string, unknown> {
  const values = new Map<string, unknown>();
  for (const frame of trajectory.frames) {
    for (const src of frame.contextSources) {
      if (src.writerId === undefined) continue;
      const id = valueKey(src.key, src.writerId);
      if (!values.has(id)) values.set(id, src.value);
    }
    // The WALK-ONLY proximate tool source carries a value `call-llm` never read
    // (`lastToolResult`) — including it here is what gives TOOL writes their
    // ablation hook. It adds nothing to L3: this module never scores.
    const prox = frame.proximateToolSource;
    if (prox?.writerId !== undefined) {
      const id = valueKey(prox.stateKey, prox.writerId);
      if (!values.has(id)) values.set(id, prox.value);
    }
  }
  return values;
}

/** Classify one write's committed value with the localizer's own classifier. */
function classifyWrite(
  key: string,
  value: unknown,
  classify: SuspectClassifier,
): ReadonlyArray<{ suspectId: string; kind: SuspectKind; spec: AblationSpec }> {
  const ctx: ClassifyContext = {
    // The classifier reads only `incompleteSources` off the node; a variable
    // slice has no CausalNode (same shape-cast loop-recall uses).
    node: { incompleteSources: undefined } as unknown as ClassifyContext['node'],
    keysWritten: [key],
    valueOf: (k) => (k === key ? value : undefined),
  };
  const seeds = classify(ctx) ?? [];
  const out: Array<{ suspectId: string; kind: SuspectKind; spec: AblationSpec }> = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    const suspectId = seed.detail?.injectionId ?? seed.detail?.toolName;
    if (suspectId === undefined) continue; // 'stage' / 'arg' — no removable identity
    if (seen.has(suspectId)) continue;
    seen.add(suspectId);
    const spec = ablationForSuspect({
      source: suspectId,
      stageName: suspectId,
      kind: seed.kind,
      detail: seed.detail,
      score: 0,
      structuralScore: 0,
      hasContentEvidence: false,
      edgePath: [],
    });
    if (spec !== undefined) out.push({ suspectId, kind: seed.kind, spec });
  }
  return out;
}

/** Merge both doors' notes without duplicating a code+detail pair. */
function mergeNotes(...lists: ReadonlyArray<readonly HonestyNote[] | undefined>): HonestyNote[] {
  const out: HonestyNote[] = [];
  const seen = new Set<string>();
  for (const list of lists ?? []) {
    for (const note of list ?? []) {
      const id = `${note.code} ${note.detail}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(note);
    }
  }
  return out;
}

/**
 * Join a footprintjs variable slice to the agent's loops and sources.
 *
 * @param slice A `keyTimeline(...)` result — the flat, JSON-safe life of one
 *   key. (Chosen over the backward `sliceForKey` deliberately: the walk needs
 *   moments in commit order, and a timeline cannot be mistaken for a DAG.)
 * @param trajectory `assembleTrajectory(artifacts)` — supplies loop frames AND
 *   the committed values used for classification.
 * @param opts `forward` (the exactness carrier) and `classify`.
 *
 * Nothing here is measured: every field is a re-label of something already
 * recorded. See the module doc.
 */
export function joinVariableSlice(
  slice: KeyTimeline,
  trajectory: Trajectory,
  opts: JoinVariableSliceOptions = {},
): AgentVariableSlice {
  const classify = opts.classify ?? defaultSuspectClassifier;
  const writerFrame = buildWriterFrameIndex(trajectory);
  const values = buildValueIndex(trajectory);
  const loopOf = (runtimeStageId: string): number | undefined => {
    const frameIdx = writerFrame.get(runtimeStageId);
    return frameIdx === undefined ? undefined : trajectory.frames[frameIdx].loopIndex;
  };

  const ablations: VariableAblationHook[] = [];
  const seenHook = new Set<string>();
  const moments: AgentKeyMoment[] = (slice.moments ?? []).map((m) => {
    const loopIndex = loopOf(m.runtimeStageId);
    if (m.kind !== 'write') {
      return {
        kind: m.kind,
        commitIdx: m.commitIdx,
        runtimeStageId: m.runtimeStageId,
        stageId: m.stageId,
        stageName: m.stageName,
        ...(m.fromWriteIdx !== undefined && { fromWriteIdx: m.fromWriteIdx }),
        ...(loopIndex !== undefined && { loopIndex }),
      };
    }
    const value = values.get(valueKey(slice.key, m.runtimeStageId));
    const sources = value === undefined ? [] : classifyWrite(slice.key, value, classify);
    for (const s of sources) {
      const id = `${m.runtimeStageId} ${s.suspectId}`;
      if (seenHook.has(id)) continue;
      seenHook.add(id);
      ablations.push({
        writerId: m.runtimeStageId,
        suspectId: s.suspectId,
        kind: s.kind,
        spec: s.spec,
      });
    }
    return {
      kind: 'write' as const,
      commitIdx: m.commitIdx,
      runtimeStageId: m.runtimeStageId,
      stageId: m.stageId,
      stageName: m.stageName,
      ...(m.verb !== undefined && { verb: m.verb }),
      ...(loopIndex !== undefined && { loopIndex }),
      ...(sources.length > 0 && { suspectKind: sources[0].kind, suspectId: sources[0].suspectId }),
    };
  });

  return {
    key: slice.key,
    moments,
    ...(slice.missing !== undefined && { missing: slice.missing }),
    coverage: dataflowCoverage(opts.forward),
    ablations,
    notes: mergeNotes(slice.notes, opts.forward?.notes),
    keysReadKind: slice.keysReadKind,
    ...(slice.readsCoverage !== undefined && { readsCoverage: slice.readsCoverage }),
  };
}

/**
 * One call, from a recorded run to a variable's joined life: `keyTimeline` +
 * `forwardSliceForKey` + `assembleTrajectory` + {@link joinVariableSlice}.
 *
 * Reads come from the snapshot's execution tree (zero setup, `readTracking` ≠
 * `'off'`); exactness comes from the run's `writeProvenance` dial. Both facts
 * ride out on the result (`readsCoverage`, `coverage`) rather than being
 * assumed.
 *
 * @example
 * ```ts
 * const life = traceVariable({ snapshot }, 'systemPromptInjections');
 * life.coverage;                    // 'exact' | 'conservative' | 'unknown'
 * life.moments.filter((m) => m.kind === 'write').map((m) => m.loopIndex);
 * ```
 */
export function traceVariable(
  artifacts: ContextBugArtifacts,
  key: StateKey,
  opts: TraceVariableOptions = {},
): AgentVariableSlice {
  const commitLog = (artifacts.snapshot.commitLog ?? []) as CommitBundle[];
  const tree = artifacts.snapshot.executionTree as StageSnapshot | undefined;
  // No execution tree ⇒ no reads to resolve; the empty map is honest (it
  // reports zero coverage) where a fabricated lookup would not be.
  const reads = tree !== undefined ? keysReadFromExecutionTree(tree) : keysReadFromMap({});
  const bound = opts.before !== undefined ? { before: opts.before } : undefined;
  return joinVariableSlice(
    keyTimeline(commitLog, key, reads, bound),
    opts.trajectory ?? assembleTrajectory(artifacts),
    {
      forward: opts.forward ?? forwardSliceForKey(commitLog, key, reads, bound),
      ...(opts.classify !== undefined && { classify: opts.classify }),
    },
  );
}
