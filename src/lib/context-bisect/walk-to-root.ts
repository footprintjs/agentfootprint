/**
 * walk-to-root — L4: the influence-guided backtracking debugger (proposal 007).
 *
 * `walkToRoot` walks BACKWARD from the symptom across loops to find the ROOT context source of a
 * DECISION bug (root ≠ proximate). Per hop: NARROW with per-loop influence (L3) → HOP along
 * `writerId` provenance to the loop that produced the culprit → ISOLATE with run-wide ablation (L2).
 * Pure orchestration over shipped tiers — no new scorer, no new ablation.
 *
 * Home: `context-bisect` (consumes Trajectory + shortlist + the localizer's ablation).
 *
 * HONESTY (the proxy CAN misdirect the hop — folded in from review):
 * - The per-hop narrow is a correlational PROXY (FA-dominated) — it points at a neighborhood and
 *   CANNOT separate a planted instruction from an innocent same-topic sibling. Three guards: (1) BEAM
 *   not top-1 (keep siblings in play); (2) ablation is the ONLY discriminator (a wrong-branch hop that
 *   doesn't flip is never `root`); (3) the narrow reorders, never drops. Remaining caveat: if the narrow
 *   never surfaces the true root into the beam, ablation never tests it and the walk stops shallow — a
 *   recall blind spot, amplified in a single chain.
 * - `root` is CAUSAL (ablation-only): set only when run-wide ablation flips on a stable baseline.
 *   Without a `rerun`, the walk is correlational and `root` is absent.
 * - FLAT charts only for the cross-loop hop — grouped loop frames are scope-isolated (degraded + flagged).
 * - Three first-class honest stops (never silent): `unseparated-siblings`, `overdetermined-or-incomplete`,
 *   `untracked-origin`.
 * - THE PROXY IS NOT ALWAYS NEEDED (`variables`, 7.12): where the recording carries per-write
 *   provenance, a suspect's state key has an EXACT recorded life — the value this loop read and the
 *   write that produced it — so the descent is a commit-log fact, not a similarity guess, and the hop
 *   says `narrowedBy: 'dataflow'`. The proxy still picks WHO; dataflow picks WHERE. Anything less than
 *   exact (dial off, stage-level edges, no dataflow, scope-isolated frames) falls back to the beam.
 *
 * VALIDATION (the descent edge is now populated on real agents — proposal 008): `assembleTrajectory`
 * surfaces each loop's proximate `lastToolResult` on the WALK-ONLY `LoopFrame.proximateToolSource`
 * field (writer = the PRODUCING loop's tool-calls stage — a cross-loop edge). `writtenByOf` reads it,
 * so on a real flat agent with tool calls the cross-loop DESCENT fires (proven at the component level:
 * the enrichment populates the edge on a real trajectory + the algorithm descends on it). It is
 * WALK-ONLY — not in `contextSources` — so L3's narrow + its measured recall are untouched.
 * END-TO-END VALIDATED (ctxbug/harness/eval-l4-walk.mjs): on a REAL agentfootprint misdirect agent
 * with a realistic embedder (bge) for the narrow and a REAL causal ablation (rebuild the agent WITHOUT
 * the planted fact → the outcome flips), the walk BURIES the plant at the symptom, DESCENDS via the
 * proximate tool edge to the wrong-decision loop, and ablation convicts `root = the planted
 * instruction` — where flat single-trigger localize does not. FLAT only — grouped's run-level
 * `lastToolResult` lives outside the per-scope inner logs (deferred, degrade-flagged below).
 */
import type { Embedder } from '../influence-core/index.js';
import { ablationForSuspect, runAblationProbe, probeFlipped, verdictFor } from './ablation.js';
import { defaultSuspectClassifier, type SuspectClassifier } from './localize.js';
import { shortlistEarlyCulprits } from './loop-recall.js';
import { assembleTrajectory } from './trajectory.js';
import type { LoopFrame, Trajectory } from './trajectory.js';
import type {
  AblationRerun,
  AblationVerdict,
  ContextBugArtifacts,
  HonestyFlag,
  Suspect,
  SuspectKind,
} from './types.js';
// Type-only (erased at build): variable-recall imports `buildWriterFrameIndex`
// from here at runtime, so the value direction stays one-way.
import type { AgentKeyMoment, AgentVariableSlice, DataflowCoverage } from './variable-recall.js';

/** One honest stop reason when the walk cannot cleanly descend/convict. */
export type RootCauseNote =
  | 'unseparated-siblings'
  | 'overdetermined-or-incomplete'
  | 'untracked-origin';

/**
 * How this hop's DESCENT TARGET was chosen:
 *
 * - `'text-similarity'` — the embedding beam picked the suspect and the hop
 *   followed that suspect's scraped provenance writer. A PROXY (the default,
 *   and the only value when no `variables` are supplied).
 * - `'dataflow'` — the descent came from the RECORDED life of the suspect's
 *   state key: the value this loop read, and the write that produced it. No
 *   embedding took part in choosing where to go. Only ever stamped when that
 *   key's dataflow is per-write EXACT (see `DataflowCoverage`) — a conservative
 *   stage-level edge always falls back to the beam.
 */
export type HopNarrowedBy = 'text-similarity' | 'dataflow';

/** One hop of the symptom→root walk. */
export interface RootCauseHop {
  /** The loop this hop examined. */
  readonly loopIndex: number;
  /** The narrowed culprit at this hop (joins a localizer Suspect 1:1). */
  readonly suspectId: string;
  readonly kind: SuspectKind;
  /** How the descent target was chosen — see {@link HopNarrowedBy}. */
  readonly narrowedBy: HopNarrowedBy;
  /** The causal convict — present only when a `rerun` ablated this hop's suspect. */
  readonly verdict?: AblationVerdict;
  /** The provenance writer this hop's culprit came from (runtimeStageId). */
  readonly writtenBy?: string;
  /** The loopIndex the walk descended to next (the writer's frame); absent if it stopped here. */
  readonly cameFrom?: number;
  /** A first-class honest stop, when applicable. */
  readonly note?: RootCauseNote;
}

export interface RootCausePath {
  /** Symptom → … in walk order. */
  readonly hops: readonly RootCauseHop[];
  /** The DEEPEST ablation-convicted hop (CAUSAL). Absent without a flip / without a rerun. */
  readonly root?: RootCauseHop;
  readonly honestyFlags: readonly HonestyFlag[];
  readonly truncated?: { readonly byHops: boolean; readonly byAblations: boolean };
}

export interface WalkToRootOptions {
  readonly embedder: Embedder;
  /** The convict tier. Without it the walk is correlational and `root` is absent. */
  readonly rerun?: AblationRerun;
  /** Top-k writers ablated per hop (NOT top-1 — the proxy can't separate same-topic siblings). Default 2. */
  readonly beamK?: number;
  /** Forwarded to the per-loop narrow. */
  readonly recencyDecay?: number;
  readonly k?: number;
  /** Walk-depth budget. Default 8. */
  readonly maxHops?: number;
  /** Total ablation-probe budget across the whole walk. Default 24. */
  readonly maxAblations?: number;
  readonly classifier?: SuspectClassifier;
  readonly signal?: AbortSignal;
  /**
   * Joined variable lives (`traceVariable` / `joinVariableSlice`), one per state
   * key you want the walk to be able to descend DETERMINISTICALLY along.
   *
   * When the narrowed suspect carries a state key whose {@link DataflowCoverage}
   * is `'exact'`, the hop's descent target is taken from that key's RECORDED
   * ancestry — the write that produced the value this loop read — instead of
   * from the proxy's provenance scrape, and the hop is stamped
   * `narrowedBy: 'dataflow'`. Anything less than exact (dial off, stage-level
   * edges, no dataflow at all, a grouped/scope-isolated frame) falls back to the
   * beam, unchanged.
   *
   * OMIT IT and the walk behaves EXACTLY as before — same hops, same order, same
   * verdicts, every hop stamped `'text-similarity'`.
   */
  readonly variables?: readonly AgentVariableSlice[];
}

/** Margin under which the top-2 narrowed candidates are "unseparated" (mirrors the toBacktrackTrace pattern). */
const UNSEPARATED_MARGIN = 0.05;

/**
 * Resolve every `writerId` to the index of the frame whose `bodyIds` contains it (NOT via
 * `parseRuntimeStageId` — that yields executionIndex, not loopIndex). A writer not in any frame
 * (run prelude / root-seeded) maps to `undefined`. Invariant: each id lands in exactly one frame.
 */
export function buildWriterFrameIndex(trajectory: Trajectory): Map<string, number> {
  const map = new Map<string, number>();
  trajectory.frames.forEach((frame, idx) => {
    for (const id of frame.bodyIds) if (!map.has(id)) map.set(id, idx);
  });
  return map;
}

/** Where one suspect in a frame came from: the writer of its slot, and the state key it rode in on. */
interface SuspectOrigin {
  /** runtimeStageId that WROTE the slot (cross-loop provenance). */
  readonly writerId: string | undefined;
  /** The state key carrying the suspect — the join into a variable's recorded life. */
  readonly stateKey: string;
}

/** Map each suspectId present in a frame to its {@link SuspectOrigin}. */
function writtenByOf(frame: LoopFrame): Map<string, SuspectOrigin> {
  const map = new Map<string, SuspectOrigin>();
  for (const src of frame.contextSources) {
    const v = src.value;
    if (Array.isArray(v)) {
      // injection slots: an array of records keyed by sourceId
      for (const rec of v as Array<Record<string, unknown>>) {
        const id = typeof rec.sourceId === 'string' ? rec.sourceId : undefined;
        if (id !== undefined && !map.has(id))
          map.set(id, { writerId: src.writerId, stateKey: src.key });
      }
    } else if (
      v !== null &&
      typeof v === 'object' &&
      typeof (v as { toolName?: unknown }).toolName === 'string'
    ) {
      // lastToolResult: a { toolName, result } object → the tool suspect
      const tool = (v as { toolName: string }).toolName;
      if (!map.has(tool)) map.set(tool, { writerId: src.writerId, stateKey: src.key });
    }
  }
  // The WALK-ONLY proximate tool source (proposal 008) — the cross-loop descent edge. NOT in
  // contextSources (L3 never scored it); walkTrajectory adds it as a hop candidate.
  const tool = frame.proximateToolSource;
  if (tool && typeof (tool.value as { toolName?: unknown })?.toolName === 'string') {
    const name = (tool.value as { toolName: string }).toolName;
    if (!map.has(name)) map.set(name, { writerId: tool.writerId, stateKey: tool.stateKey });
  }
  return map;
}

/**
 * The DETERMINISTIC descent: the write that produced the value this loop's
 * `call-llm` read of `stateKey` — straight off the recorded moments, no
 * embedding involved.
 *
 * Preference order, both commit-log facts:
 *   1. the read moment BY this loop's call-llm → its `fromWriteIdx` → that
 *      write (exact value identity — footprintjs pins the same rule its forward
 *      walk uses);
 *   2. otherwise the last write strictly before the call-llm's commit (the key
 *      the call-llm did not read directly — e.g. an inferred proximate).
 *
 * Returns `undefined` unless coverage is EXACT: a conservative (stage-level)
 * edge must never be presented as an exact hop.
 */
function dataflowWriter(
  slice: AgentVariableSlice | undefined,
  frame: LoopFrame,
): AgentKeyMoment | undefined {
  const coverage: DataflowCoverage | undefined = slice?.coverage;
  if (slice === undefined || coverage !== 'exact') return undefined;
  // Grouped frames index a subflow's OWN inner log; a run-log slice cannot be
  // joined to them (see LoopFrame.subflowScope).
  if (frame.subflowScope !== undefined) return undefined;

  const writes = slice.moments.filter((m) => m.kind === 'write');
  const read =
    frame.llmCallId !== undefined
      ? slice.moments.find((m) => m.kind === 'read' && m.runtimeStageId === frame.llmCallId)
      : undefined;
  if (read?.fromWriteIdx !== undefined) {
    return writes.find((w) => w.commitIdx === read.fromWriteIdx);
  }
  const llmIdx = frame.llmCallArrayIdx;
  if (llmIdx === undefined) return undefined;
  const before = writes.filter((w) => w.commitIdx < llmIdx);
  return before.length > 0 ? before[before.length - 1] : undefined;
}

/** A minimal Suspect for ablationForSuspect (only kind + detail identity are read). */
function suspectFor(suspectId: string, kind: SuspectKind): Suspect {
  const detail = kind === 'tool' ? { toolName: suspectId } : { injectionId: suspectId };
  return {
    source: suspectId,
    stageName: suspectId,
    kind,
    detail,
    score: 0,
    structuralScore: 0,
    hasContentEvidence: false,
    edgePath: [],
  } as Suspect;
}

/**
 * Walk backward from the symptom to the root context source — from a recorded run.
 * Thin wrapper: `assembleTrajectory` then {@link walkTrajectory}. See module docs for the honesty model.
 */
export async function walkToRoot(
  artifacts: ContextBugArtifacts,
  opts: WalkToRootOptions,
): Promise<RootCausePath> {
  return walkTrajectory(assembleTrajectory(artifacts), opts);
}

/**
 * The walk itself, over an already-assembled {@link Trajectory} (composable + directly testable).
 * FLAT charts only for the cross-loop hop; grouped charts degrade (within-loop) with a flag.
 */
export async function walkTrajectory(
  trajectory: Trajectory,
  opts: WalkToRootOptions,
): Promise<RootCausePath> {
  const beamK = opts.beamK ?? 2;
  const maxHops = opts.maxHops ?? 8;
  const maxAblations = opts.maxAblations ?? 24;
  const classify = opts.classifier ?? defaultSuspectClassifier;
  const honestyFlags: HonestyFlag[] = [...trajectory.honestyFlags];

  const grouped = trajectory.frames.some((f) => f.subflowScope !== undefined);
  if (grouped) {
    honestyFlags.push({
      flag: 'untracked-sources',
      note: 'cross-loop hop unavailable for the grouped chart — loop frames are scope-isolated; the walk degrades to within one loop.',
    });
  }

  const writerFrame = buildWriterFrameIndex(trajectory);
  const variables = new Map((opts.variables ?? []).map((v) => [v.key, v]));
  const variableOf = (key: string): AgentVariableSlice | undefined => variables.get(key);

  // Baseline stability (the un-ablated scenario must reproduce for any ablation verdict to be trusted).
  let baselineStable = true;
  let ablationsUsed = 0;
  if (opts.rerun) {
    const baseline = await runAblationProbe({ embedder: opts.embedder, rerun: opts.rerun }, []);
    ablationsUsed++;
    baselineStable = !probeFlipped(baseline);
  }

  const hops: RootCauseHop[] = [];
  const visited = new Set<string>();
  let frameIdx = trajectory.frames.length - 1; // start at the symptom (final loop)
  let byHops = false;
  let byAblations = false;

  while (frameIdx >= 0) {
    if (hops.length >= maxHops) {
      byHops = true;
      break;
    }
    const frame = trajectory.frames[frameIdx];

    // NARROW: rank THIS loop's suspects by per-loop influence (single-frame sub-trajectory).
    const sub: Trajectory = { frames: [frame], prelude: [], honestyFlags: [] };
    const shortlist = await shortlistEarlyCulprits(sub, {
      embedder: opts.embedder,
      ...(opts.recencyDecay !== undefined ? { recencyDecay: opts.recencyDecay } : {}),
      ...(opts.k !== undefined ? { k: opts.k } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      classifier: classify,
    });
    const beam = shortlist.candidates.slice(0, beamK);
    if (beam.length === 0) break;

    const writtenBy = writtenByOf(frame);
    const unseparated =
      beam.length >= 2 && Math.abs(beam[0].recallScore - beam[1].recallScore) < UNSEPARATED_MARGIN;

    // ISOLATE: run-wide ablation of each NARROWED injection candidate; ablation is the only
    // discriminator (a wrong-branch narrow that doesn't flip is never the root).
    let chosen: { suspectId: string; kind: SuspectKind } = beam[0];
    let chosenVerdict: AblationVerdict | undefined;
    let convicted = false;
    if (opts.rerun) {
      for (const cand of beam) {
        if (ablationsUsed >= maxAblations) {
          byAblations = true;
          break;
        }
        const spec = ablationForSuspect(suspectFor(cand.suspectId, cand.kind));
        if (spec === undefined) continue;
        const stats = await runAblationProbe({ embedder: opts.embedder, rerun: opts.rerun }, [
          spec,
        ]);
        ablationsUsed++;
        if (baselineStable && probeFlipped(stats)) {
          chosen = cand;
          chosenVerdict = verdictFor(`ablate ${cand.suspectId}`, stats, baselineStable);
          convicted = true;
          break; // ablation picked this loop's root
        }
      }
    }

    // NARROW → HOP. The beam picked WHO; this picks WHERE. When the narrowed
    // suspect rode in on a state key whose dataflow is per-write EXACT, WHERE is
    // a commit-log fact — the write that produced the value THIS loop read —
    // instead of a provenance scrape or an inferred proximate. Absent
    // `variables`, `exactWriter` is always undefined and nothing below changes.
    const beamOrigin = writtenBy.get(chosen.suspectId);
    const exactWrite =
      beamOrigin?.stateKey !== undefined
        ? dataflowWriter(variableOf(beamOrigin.stateKey), frame)
        : undefined;
    const exactFrameIdx =
      exactWrite !== undefined ? writerFrame.get(exactWrite.runtimeStageId) : undefined;
    const exactWriter =
      exactWrite !== undefined && exactFrameIdx !== undefined && exactFrameIdx < frameIdx
        ? exactWrite.runtimeStageId
        : undefined; // strictly backward, or it is no descent at all

    // The proximate tool source (walk-only, proposal 008) is the cross-loop DESCENT edge. When this
    // loop did NOT convict, follow it back to the loop that PRODUCED the tool output the decision was
    // conditioned on — that's where a buried root (e.g. the misdirecting instruction) scores + convicts.
    // It is an INFERRED proximate (`call-llm` read `history`, not this key), so a RECORDED exact edge
    // for the narrowed suspect outranks it: better evidence wins, and the hop says which it used.
    const toolName =
      !convicted &&
      exactWriter === undefined &&
      frame.proximateToolSource &&
      typeof (frame.proximateToolSource.value as { toolName?: unknown })?.toolName === 'string'
        ? (frame.proximateToolSource.value as { toolName: string }).toolName
        : undefined;
    if (toolName !== undefined) chosen = { suspectId: toolName, kind: 'tool' };

    const narrowedBy: HopNarrowedBy = exactWriter !== undefined ? 'dataflow' : 'text-similarity';
    const writer = exactWriter ?? writtenBy.get(chosen.suspectId)?.writerId;
    const nextFrameIdx = writer !== undefined ? writerFrame.get(writer) : undefined;
    const descendIdx =
      nextFrameIdx !== undefined && nextFrameIdx < frameIdx ? nextFrameIdx : undefined; // strictly backward

    // Per-hop honest note: untracked-origin (structural — no provenance writer to descend) is set
    // regardless of a rerun; unseparated-siblings flags a narrow that couldn't separate the top-2.
    const inlineNote: RootCauseNote | undefined =
      writer === undefined
        ? 'untracked-origin'
        : unseparated && !convicted
        ? 'unseparated-siblings'
        : undefined;

    hops.push({
      loopIndex: frame.loopIndex,
      suspectId: chosen.suspectId,
      kind: chosen.kind,
      narrowedBy,
      ...(chosenVerdict ? { verdict: chosenVerdict } : {}),
      ...(writer !== undefined ? { writtenBy: writer } : {}),
      ...(descendIdx !== undefined ? { cameFrom: trajectory.frames[descendIdx].loopIndex } : {}),
      ...(inlineNote ? { note: inlineNote } : {}),
    });

    if (convicted) break; // root found at this loop (injections are same-loop-seeded — terminal)
    const visitKey = `${chosen.suspectId}@${frame.loopIndex}`;
    if (descendIdx === undefined || visited.has(visitKey)) break; // dead end / cycle
    visited.add(visitKey);
    frameIdx = descendIdx;
  }

  // root = the ablation-convicted hop (the walk breaks there).
  let root: RootCauseHop | undefined;
  for (const hop of hops) if (hop.verdict?.verdict === 'confirmed') root = hop;

  // Terminal honesty note: a rerun ran but the walk ended without a causal root, AND the last hop
  // had a descendable provenance writer (so it's "could-not-convict", not "untracked-origin").
  if (opts.rerun && root === undefined && hops.length > 0) {
    const last = hops[hops.length - 1];
    if (last.note === undefined && last.writtenBy !== undefined) {
      hops[hops.length - 1] = { ...last, note: 'overdetermined-or-incomplete' };
    }
  }

  return {
    hops,
    ...(root ? { root } : {}),
    honestyFlags,
    ...(byHops || byAblations ? { truncated: { byHops, byAblations } } : {}),
  };
}
