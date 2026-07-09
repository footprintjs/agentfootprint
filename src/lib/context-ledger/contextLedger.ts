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
 */

import {
  commitValueAt,
  findLastWriter,
  flattenCausalDAG,
  keysReadFromExecutionTree,
  sliceForKey,
} from 'footprintjs/trace';
import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';

import { parseRuntimeStageId, splitStageId } from 'footprintjs/trace';
import { INJECTION_KEYS, SUBFLOW_IDS } from '../../conventions.js';
import type {
  ContextLedger,
  LedgerRow,
  PieceKind,
  RecordedRun,
  RunnerLike,
  UsedSignal,
} from './types.js';

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
  executionTree?: unknown;
  subflowResults?: Record<string, { treeContext?: { history?: CommitBundle[] } }>;
}

/** sf-llm-call mount keys in loop order — grouped-mode iterations live in
 *  their own retained inner logs (the same projection context-bisect's
 *  assembleGroupedTrajectory uses). */
function llmCallMountKeys(subflowResults: Record<string, unknown> | undefined): string[] {
  if (!subflowResults) return [];
  return Object.keys(subflowResults)
    .filter(
      (k) => k.includes('#') && splitStageId(k.split('#')[0]).localStageId === SUBFLOW_IDS.LLM_CALL,
    )
    .sort((a, b) => parseRuntimeStageId(a).executionIndex - parseRuntimeStageId(b).executionIndex);
}

function snapshotOf(source: RunnerLike | unknown): SnapshotLike | undefined {
  const maybeRunner = source as { getLastSnapshot?: unknown };
  if (typeof maybeRunner?.getLastSnapshot === 'function') {
    return (maybeRunner.getLastSnapshot as () => unknown)() as SnapshotLike | undefined;
  }
  return source as SnapshotLike | undefined;
}

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
    const snapshot = snapshotOf(source);
    const log = snapshot?.commitLog;
    if (!log?.length) return undefined;

    runsRecorded += 1;
    const runRef = `run-${runsRecorded}`;
    const offeredKeys = new Set<string>();

    const offer = (kind: PieceKind, id: string, tokens: number): void => {
      const row = rowOf(kind, id);
      row.offered += 1;
      row.approxTokensSpent += tokens;
      offeredKeys.add(`${kind}:${id}`);
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

    const foldOffersFrom = (bundles: CommitBundle[]): void => {
      let injections: ActiveInjectionLike[] = [];
      let schemas: ToolSchemaLike[] = [];
      for (let i = 0; i < bundles.length; i++) {
        const paths = new Set(bundles[i].trace.map((t) => t.path));
        if (paths.has('activeInjections')) {
          const v = commitValueAt(bundles, i, 'activeInjections');
          if (Array.isArray(v)) injections = v as ActiveInjectionLike[];
        }
        if (paths.has('dynamicToolSchemas')) {
          const v = commitValueAt(bundles, i, 'dynamicToolSchemas');
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
        const inner = snapshot?.subflowResults?.[key]?.treeContext?.history;
        if (Array.isArray(inner)) foldOffersFrom(inner);
      }
    } else {
      foldOffersFrom(log);
    }

    // A run with NO call markers anywhere is a shape this ledger cannot
    // meter (e.g. the LLMCall runner, which never writes totalInputTokens)
    // — report honestly instead of confidently recording zero offers.
    if (callMarkers === 0) {
      runsRecorded -= 1;
      return undefined;
    }

    // ── USES: tool calls (assistant messages in the final history) ───────
    const lastIdx = log.length - 1;
    const history = commitValueAt(log, lastIdx, 'history');
    if (Array.isArray(history)) {
      for (const msg of history as HistoryMessageLike[]) {
        if (msg?.role !== 'assistant' || !Array.isArray(msg.toolCalls)) continue;
        for (const call of msg.toolCalls) {
          if (call?.name) markUsed('tool', call.name, 'tool-called');
        }
      }
    }

    // ── USES: skill activations ──────────────────────────────────────────
    const activated = commitValueAt(log, lastIdx, 'activatedInjectionIds');
    if (Array.isArray(activated)) {
      for (const id of activated as string[]) {
        if (typeof id === 'string' && id.length > 0) markUsed('skill', id, 'skill-activated');
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
        const finalInjections = commitValueAt(log, lastIdx, 'activeInjections');
        const finalBySlotKey = new Map<string, ActiveInjectionLike[]>();
        // Which slot carried each injection is projected per-slot into the
        // INJECTION_KEYS records — fold each slot key's final value.
        for (const slotKey of Object.values(INJECTION_KEYS)) {
          const writer = findLastWriter(log, slotKey);
          if (!writer || !memberIds.has(writer.runtimeStageId)) continue;
          const slotRecords = commitValueAt(log, lastIdx, slotKey);
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
            markUsed(kind, id, 'answer-slice(slot)');
          }
        }
      }
    }

    // runsSeen: once per run per offered piece.
    for (const key of offeredKeys) {
      const row = table.get(key);
      if (row) row.runsSeen += 1;
    }
    runOffers.set(runRef, offeredKeys);
    lastRunRef = runRef;
    return { runRef, offeredPieces: [...offeredKeys], sliceAvailable };
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
