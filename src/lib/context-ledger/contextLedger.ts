/**
 * contextLedger — the post-run bookkeeper (see types.ts for the WHY).
 *
 * DESIGN: a pure POST-RUN analyzer over the run's own commit log — no live
 * recorder lifecycle, no event-order coupling. Everything it counts is
 * already durably recorded by the engine (dogfooding: offers come from
 * `commitValueAt` folds, answer attribution from `sliceForKey` — the same
 * canonical queries every triage surface uses):
 *
 *   offers  — the context IN EFFECT at each LLM call. Call marker: a
 *             commit that wrote `totalInputTokens` (monotonic — never
 *             net-change-dropped) and did NOT write `userMessage` (which
 *             only the seed writes). At each call index, fold
 *             `activeInjections` + `dynamicToolSchemas`, and add the
 *             STATIC tool registry (duck-read from the runner's public
 *             `getUIGroup().extra.toolNames` — static registries live in a
 *             closure, never in scope state). NOTE offers are deliberately
 *             NOT "per context-key commit": the net-change filter drops
 *             identical re-commits, so stable context appears once in the
 *             log while still being offered (and paying tokens) per call.
 *             Static-registry tools count offers with approxTokens 0 in L1
 *             (their schema JSON isn't in the log) — earnRate, the gate
 *             signal, is unaffected; dynamicToolSchemas carries real sizes.
 *   uses    — tool: assistant messages' toolCalls in the final history;
 *             skill: `activatedInjectionIds`;
 *             injection: its SLOT's write sits on the final answer's
 *             backward slice (slot-granular, labeled).
 *   outcome — consumer label per run, credited to every offered piece.
 *
 * The slot→slice join needs NO id conventions: for each slot key
 * (INJECTION_KEYS.*), `findLastWriter` names the commit that fed the final
 * LLM call; membership of that writer in the answer slice IS the signal.
 *
 * Every read goes through footprintjs's BASIS twins (`commitValueAtWithBasis`,
 * `findLastWriterWithBasis`): an answer that rests on nested rows, the
 * pre-run state, a redaction or a delete says so on `RecordedRun.basis`
 * (per key, absent when every answer was exact) instead of being counted as
 * if it were exact.
 *
 * UNDER A REDACTION POLICY (an agent's `redact`, `src/redaction/`) the log
 * holds the placeholder wherever the policy selected a value — footprintjs
 * scrubs it as it is written. The gates decide what LATER runs are offered,
 * so a placeholder must never read as "never used":
 *   - a FINAL value the log keeps out (the history the tool calls are counted
 *     from, the slot records) is read from the run's LIVE end state when the
 *     source is a runner of this library (`sourceOf` — `core/runnerLive.ts`);
 *     only ids and counts reach a row, never a value;
 *   - a read nothing can answer (a value per call — the log is the only record
 *     of what each call was offered — or any read from a snapshot handed in)
 *     leaves its kind UNMETERED for the run (`READS_OF`): neither its offers
 *     nor its uses are counted, `RecordedRun.unmetered` names it, and a gate
 *     keeps offering it as it does a piece with too few offers to judge.
 */

import {
  commitValueAtWithBasis,
  findLastWriterWithBasis,
  flattenCausalDAG,
  keysReadFromExecutionTree,
  sliceForKey,
} from 'footprintjs/trace';
import type { CommitBundle, ValueBasis } from 'footprintjs/trace';
import type { StageSnapshot } from 'footprintjs/advanced';

import { INJECTION_KEYS } from '../../conventions.js';
// The flat/grouped fork, from its ONE owner (9.88.0). This file used to carry a
// private copy and `context-bisect/trajectory.ts` carried its byte-twin; two
// answers to "which log is iteration k in?" is one answer too many.
import { llmCallMountKeys } from '../time-travel/epochs.js';
import type {
  ContextLedger,
  LedgerRow,
  PieceKind,
  RecordedRun,
  RunnerLike,
  UsedSignal,
} from './types.js';
import { runnerLive } from '../../core/runnerLive.js';

/** chars ÷ 4 — a serialized-length ESTIMATE, deliberately rough and cheap. */
function approxTokens(value: unknown): number {
  try {
    return Math.ceil(JSON.stringify(value).length / 4);
  } catch {
    return 0;
  }
}

interface MutableRow {
  id: string;
  kind: PieceKind;
  offered: number;
  approxTokensSpent: number;
  used: number;
  usedVia: Partial<Record<UsedSignal, number>>;
  runsSeen: number;
  outcomes: Record<string, number>;
}

interface SnapshotLike {
  commitLog?: CommitBundle[];
  /** The log's fold base — passed to the value twin so an unseeded key is not called partial. */
  initialState?: Record<string, unknown>;
  executionTree?: unknown;
  subflowResults?: Record<
    string,
    { treeContext?: { history?: CommitBundle[]; initialState?: Record<string, unknown> } }
  >;
}

/** What one `recordRun` reads. */
interface LedgerSource {
  readonly snapshot: SnapshotLike | undefined;
  /**
   * The run's LIVE committed root state — present for a runner of this library
   * only (`core/runnerLive.ts`). It answers a FINAL value the log keeps out.
   */
  readonly liveState?: Readonly<Record<string, unknown>>;
}

/**
 * The snapshot to count from. A runner of this library: its LIVE snapshot and
 * state — the same run its served `getLastSnapshot()` describes, with the fold
 * base a served snapshot omits. Any other runner: `getLastSnapshot()`. A
 * snapshot: itself (a served one keeps its placeholders — `READS_OF`).
 */
function sourceOf(source: RunnerLike | unknown): LedgerSource {
  const live = source !== null && typeof source === 'object' ? runnerLive(source) : undefined;
  if (live !== undefined) {
    const liveState = live.liveState();
    return {
      snapshot: live.liveSnapshot() as SnapshotLike | undefined,
      ...(liveState !== undefined && { liveState }),
    };
  }
  const maybeRunner = source as { getLastSnapshot?: unknown };
  if (typeof maybeRunner?.getLastSnapshot === 'function') {
    return {
      snapshot: (maybeRunner.getLastSnapshot as () => unknown)() as SnapshotLike | undefined,
    };
  }
  return { snapshot: source as SnapshotLike | undefined };
}

/**
 * The state keys each kind's offers and uses are read from. A kind is
 * UNMETERED in a run when a read of one of them rests on a redaction
 * (`basis: 'redacted'`) that no live state answered: the ledger cannot tell
 * what was offered or used, so it counts neither for that kind — a gate never
 * judges a piece on a run whose uses the record kept out.
 */
const READS_OF: Readonly<Record<PieceKind, readonly string[]>> = {
  tool: ['dynamicToolSchemas', 'history'],
  skill: ['activeInjections', 'activatedInjectionIds', ...Object.values(INJECTION_KEYS)],
  injection: ['activeInjections', ...Object.values(INJECTION_KEYS)],
};

/** Static tool registry names, duck-read from the runner's public UI-group
 *  metadata (Agent fills `extra.toolNames`). Empty for non-runner sources. */
function staticToolNamesOf(source: RunnerLike | unknown): readonly string[] {
  const maybeRunner = source as {
    getUIGroup?: () => { extra?: { toolNames?: unknown } } | undefined;
  };
  if (typeof maybeRunner?.getUIGroup !== 'function') return [];
  try {
    const names = maybeRunner.getUIGroup()?.extra?.toolNames;
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

/** Duck-typed shapes of the state values the ledger folds. */
interface ActiveInjectionLike {
  id?: string;
  flavor?: string;
}
interface ToolSchemaLike {
  name?: string;
}
interface HistoryMessageLike {
  role?: string;
  toolCalls?: Array<{ name?: string }>;
}

// FOLD · the one owner of which context pieces earned their tokens, derived only from the run's own commit log
// consumers read this and never re-derive it: gates.ts (ledgerToolGate / ledgerEntryScorer / ledgerGated) and the consumer
// detached: yes — rows are derived per call, each carrying usedVia so a reader sees why it counted.
export function contextLedger(): ContextLedger {
  const table = new Map<string, MutableRow>(); // key: `${kind}:${id}`
  const runOffers = new Map<string, Set<string>>(); // runRef → offered keys
  let runsRecorded = 0;
  let lastRunRef: string | undefined;

  function rowOf(kind: PieceKind, id: string): MutableRow {
    const key = `${kind}:${id}`;
    let row = table.get(key);
    if (!row) {
      row = {
        id,
        kind,
        offered: 0,
        approxTokensSpent: 0,
        used: 0,
        usedVia: {},
        runsSeen: 0,
        outcomes: {},
      };
      table.set(key, row);
    }
    return row;
  }

  function markUsed(kind: PieceKind, id: string, via: UsedSignal): void {
    const row = rowOf(kind, id);
    row.used += 1;
    row.usedVia[via] = (row.usedVia[via] ?? 0) + 1;
  }

  function recordRun(source: RunnerLike | unknown): RecordedRun | undefined {
    const { snapshot, liveState } = sourceOf(source);
    const log = snapshot?.commitLog;
    if (!log?.length) return undefined;

    runsRecorded += 1;
    const runRef = `run-${runsRecorded}`;

    // Offers and uses are COLLECTED as the folds find them and counted at the
    // end, so a kind the record keeps out stays uncounted as a whole (`READS_OF`).
    const offers: Array<{ kind: PieceKind; id: string; tokens: number }> = [];
    const uses: Array<{ kind: PieceKind; id: string; via: UsedSignal }> = [];

    // The reason codes behind every non-exact answer read below, per key.
    const basisByKey = new Map<string, Set<ValueBasis>>();
    const noteBasis = (key: string, codes: readonly ValueBasis[]): void => {
      if (codes.length === 0) return;
      let seen = basisByKey.get(key);
      if (!seen) basisByKey.set(key, (seen = new Set()));
      for (const code of codes) seen.add(code);
    };
    const valueAt = (
      bundles: CommitBundle[],
      initialState: Record<string, unknown> | undefined,
      idx: number,
      key: string,
    ): unknown => {
      const { value, basis } = commitValueAtWithBasis(bundles, idx, key, { initialState });
      noteBasis(key, basis);
      return value;
    };

    const offer = (kind: PieceKind, id: string, tokens: number): void => {
      offers.push({ kind, id, tokens });
    };
    const use = (kind: PieceKind, id: string, via: UsedSignal): void => {
      uses.push({ kind, id, via });
    };

    // ── OFFERS: the context IN EFFECT at each LLM call ───────────────────
    // Call marker: wrote totalInputTokens (monotonic — survives the
    // net-change filter) and NOT userMessage (the seed's unique write).
    // A SINGLE forward pass per log tracks the latest context values as
    // writes appear (one commitValueAt per actual write — O(N), review
    // finding #3), so each marker reads the context in effect exactly even
    // though identical re-commits are dropped from the log.
    //
    // GROUPED reactMode (review finding #1): call-llm + the slots live
    // INSIDE per-iteration `sf-llm-call#k` subflow logs (their context keys
    // never bubble to the root), so offers fold over each retained inner
    // log — the same projection context-bisect's grouped trajectory uses.
    const staticTools = staticToolNamesOf(source);
    let callMarkers = 0;

    const foldOffersFrom = (
      bundles: CommitBundle[],
      initialState: Record<string, unknown> | undefined,
    ): void => {
      let injections: ActiveInjectionLike[] = [];
      let schemas: ToolSchemaLike[] = [];
      for (let i = 0; i < bundles.length; i++) {
        const paths = new Set(bundles[i].trace.map((t) => t.path));
        if (paths.has('activeInjections')) {
          const v = valueAt(bundles, initialState, i, 'activeInjections');
          if (Array.isArray(v)) injections = v as ActiveInjectionLike[];
        }
        if (paths.has('dynamicToolSchemas')) {
          const v = valueAt(bundles, initialState, i, 'dynamicToolSchemas');
          if (Array.isArray(v)) schemas = v as ToolSchemaLike[];
        }
        if (!paths.has('totalInputTokens') || paths.has('userMessage')) continue;
        callMarkers += 1;

        for (const inj of injections) {
          if (!inj?.id) continue;
          const kind: PieceKind = inj.flavor === 'skill' ? 'skill' : 'injection';
          offer(kind, inj.id, approxTokens(inj));
        }
        // Tools: dynamic schemas (real sizes) + the static registry (offer
        // counted, size unknowable from the log in L1 — earnRate unaffected).
        const offeredToolsThisCall = new Set<string>();
        for (const schema of schemas) {
          if (!schema?.name || offeredToolsThisCall.has(schema.name)) continue;
          offeredToolsThisCall.add(schema.name);
          offer('tool', schema.name, approxTokens(schema));
        }
        for (const name of staticTools) {
          if (offeredToolsThisCall.has(name)) continue;
          offeredToolsThisCall.add(name);
          offer('tool', name, 0);
        }
      }
    };

    const mountKeys = llmCallMountKeys(snapshot?.subflowResults);
    if (mountKeys.length > 0) {
      for (const key of mountKeys) {
        const tree = snapshot?.subflowResults?.[key]?.treeContext;
        if (Array.isArray(tree?.history)) foldOffersFrom(tree.history, tree.initialState);
      }
    } else {
      foldOffersFrom(log, snapshot?.initialState);
    }

    // A run with NO call markers anywhere is a shape this ledger cannot
    // meter (e.g. the LLMCall runner, which never writes totalInputTokens)
    // — report honestly instead of confidently recording zero offers.
    if (callMarkers === 0) {
      runsRecorded -= 1;
      return undefined;
    }

    // ── FINAL values: the log at its last commit. One the log keeps out (a
    // redaction) is read from the run's live end state when there is one —
    // the answer is then exact, so it notes no basis.
    const lastIdx = log.length - 1;
    const runBase = snapshot?.initialState;
    const finalValue = (key: string): unknown => {
      const { value, basis } = commitValueAtWithBasis(log, lastIdx, key, {
        initialState: runBase,
      });
      if (liveState !== undefined && basis.includes('redacted')) return liveState[key];
      noteBasis(key, basis);
      return value;
    };

    // ── USES: tool calls (assistant messages in the final history) ───────
    const history = finalValue('history');
    if (Array.isArray(history)) {
      for (const msg of history as HistoryMessageLike[]) {
        if (msg?.role !== 'assistant' || !Array.isArray(msg.toolCalls)) continue;
        for (const call of msg.toolCalls) {
          if (call?.name) use('tool', call.name, 'tool-called');
        }
      }
    }

    // ── USES: skill activations ──────────────────────────────────────────
    const activated = finalValue('activatedInjectionIds');
    if (Array.isArray(activated)) {
      for (const id of activated as string[]) {
        if (typeof id === 'string' && id.length > 0) use('skill', id, 'skill-activated');
      }
    }

    // ── USES: answer-slice membership per slot (slot-granular, honest) ───
    // Slice the final answer; a slot counts as "on the answer's dependency
    // chain" when its key's LAST WRITER is a slice member. Every injection
    // in the FINAL context of that slot gets the (shared) credit.
    let sliceAvailable = false;
    const tree = snapshot?.executionTree as StageSnapshot | undefined;
    if (tree) {
      const reads = keysReadFromExecutionTree(tree);
      const slice = sliceForKey(log, 'finalContent', reads);
      if (slice.root) {
        sliceAvailable = true;
        const memberIds = new Set(flattenCausalDAG(slice.root).map((n) => n.runtimeStageId));
        const finalInjections = finalValue('activeInjections');
        const finalBySlotKey = new Map<string, ActiveInjectionLike[]>();
        // Which slot carried each injection is projected per-slot into the
        // INJECTION_KEYS records — fold each slot key's final value.
        for (const slotKey of Object.values(INJECTION_KEYS)) {
          const { writer, basis } = findLastWriterWithBasis(log, slotKey);
          noteBasis(slotKey, basis);
          if (!writer || !memberIds.has(writer.runtimeStageId)) continue;
          const slotRecords = finalValue(slotKey);
          if (Array.isArray(slotRecords))
            finalBySlotKey.set(slotKey, slotRecords as ActiveInjectionLike[]);
        }
        // Credit: injections present in a slice-member slot's final records.
        const activeById = new Map<string, ActiveInjectionLike>();
        if (Array.isArray(finalInjections)) {
          for (const inj of finalInjections as ActiveInjectionLike[]) {
            if (inj?.id) activeById.set(inj.id, inj);
          }
        }
        for (const records of finalBySlotKey.values()) {
          for (const rec of records) {
            const id = (rec as { id?: string })?.id;
            if (!id) continue;
            const flavor = activeById.get(id)?.flavor ?? (rec as { source?: string }).source;
            const kind: PieceKind = flavor === 'skill' ? 'skill' : 'injection';
            use(kind, id, 'answer-slice(slot)');
          }
        }
      }
    }

    // ── COUNT: every metered kind's offers, then its uses ────────────────
    const keptOut = (key: string): boolean => basisByKey.get(key)?.has('redacted') === true;
    const unmetered = (Object.keys(READS_OF) as PieceKind[]).filter((kind) =>
      READS_OF[kind].some(keptOut),
    );
    const offeredKeys = new Set<string>();
    for (const { kind, id, tokens } of offers) {
      if (unmetered.includes(kind)) continue;
      const row = rowOf(kind, id);
      row.offered += 1;
      row.approxTokensSpent += tokens;
      offeredKeys.add(`${kind}:${id}`);
    }
    for (const { kind, id, via } of uses) {
      if (!unmetered.includes(kind)) markUsed(kind, id, via);
    }

    // runsSeen: once per run per offered piece.
    for (const key of offeredKeys) {
      const row = table.get(key);
      if (row) row.runsSeen += 1;
    }
    runOffers.set(runRef, offeredKeys);
    lastRunRef = runRef;
    return {
      runRef,
      offeredPieces: [...offeredKeys],
      sliceAvailable,
      ...(basisByKey.size > 0 && {
        basis: Object.fromEntries([...basisByKey].map(([key, codes]) => [key, [...codes]])),
      }),
      ...(unmetered.length > 0 && { unmetered }),
    };
  }

  function recordOutcome(label: string, runRef?: string): boolean {
    const ref = runRef ?? lastRunRef;
    if (!ref) return false;
    const offered = runOffers.get(ref);
    if (!offered) return false;
    for (const key of offered) {
      const row = table.get(key);
      if (row) row.outcomes[label] = (row.outcomes[label] ?? 0) + 1;
    }
    return true;
  }

  function freeze(row: MutableRow): LedgerRow {
    return {
      ...row,
      usedVia: { ...row.usedVia },
      outcomes: { ...row.outcomes },
      earnRate: row.offered > 0 ? row.used / row.offered : 0,
    };
  }

  return {
    recordRun,
    recordOutcome,
    rows: () => [...table.values()].map(freeze).sort((a, b) => a.earnRate - b.earnRate),
    row: (kind, id) => {
      const row = table.get(`${kind}:${id}`);
      return row ? freeze(row) : undefined;
    },
    exportJSON: () => ({ version: 1, rows: [...table.values()].map(freeze), runsRecorded }),
    importJSON: (json) => {
      if (json?.version !== 1) return;
      for (const r of json.rows) {
        const row = rowOf(r.kind, r.id);
        row.offered += r.offered;
        row.approxTokensSpent += r.approxTokensSpent;
        row.used += r.used;
        row.runsSeen += r.runsSeen;
        for (const [via, n] of Object.entries(r.usedVia)) {
          row.usedVia[via as UsedSignal] = (row.usedVia[via as UsedSignal] ?? 0) + (n ?? 0);
        }
        for (const [label, n] of Object.entries(r.outcomes)) {
          row.outcomes[label] = (row.outcomes[label] ?? 0) + n;
        }
      }
      runsRecorded += json.runsRecorded;
    },
  };
}
