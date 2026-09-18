/**
 * findings/ledger — where the model's standings become record.
 *
 * Pattern: one writer for one committed key (the twin of
 *          `core/agent/middleware/ledger.ts · recordDecisions`).
 * Role:    core/ layer leaf. The dispatch loop and the route decider build
 *          rows with `basisRowFrom` / `standingRowsFrom`; `recordFindings` is
 *          the ONLY thing that writes `AgentState.findingsLedger` and emits
 *          the matching events, so the two call sites cannot record the same
 *          declaration two different ways. `foldLedger` is the read: the
 *          current standing per result and the conflicts among what is
 *          stood on, recomputed from the rows every time.
 * Emits:   `agentfootprint.findings.declared` (one per basis row),
 *          `agentfootprint.findings.standing` (one per standing row),
 *          since 9.104.0 `agentfootprint.findings.judged` /
 *          `agentfootprint.findings.judge_failed` (one per judgment /
 *          judgment-error row, filed by `judge.ts`), and since 9.110.0
 *          `agentfootprint.findings.contingent` (one per contingent row,
 *          filed by the two moments `contingent.ts` serves: the route
 *          decider's answer and the dispatch loop's call) — identities,
 *          enums and numbers only. Assertion values, `settles`, `line`, the
 *          judged state and the contingent VALUE live in the committed key
 *          under whatever redaction the run configured; an event stream
 *          fans out to sinks we do not control.
 *
 * ## Append only, last wins, conflicts are a fold
 *
 * A row is never replaced. A second standing on the same result is a second
 * row and the fold takes the LAST — the earlier one is quotable history, and
 * two rows that disagree are NOT a conflict (the algebra sees assertions,
 * never standings). A conflict row is written ONCE per key, at the write
 * whose stood-on readings first disagreed, from `conflictsOf`'s output and
 * never by hand; a later `ruled-out` retires a witness in the FOLD without
 * touching the row, so `foldLedger(...).conflicts` is the current set and the
 * conflict rows are the history of when each was first seen.
 *
 * ## Why the writer emits by literal
 *
 * The event names are the registry's `EVENT_NAMES.findings.declared` and
 * `.standing`; `typedEmit` binds the literal to `AgentfootprintEventMap`, so
 * a drift between this file and the registry is a compile error, exactly as
 * `recordDecisions` spells `agentfootprint.middleware.decision`.
 */

import { isPlacedToolResult } from '../../../artifacts/placement.js';
import { conflictsOf, type Conflict } from '../../../integrity/assertion/conflicts.js';
import { assertionKey, type Assertion } from '../../../integrity/assertion/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import {
  PROPOSITION_CHARS,
  type BasisRow,
  type ConflictRow,
  type ConflictWitness,
  type DeclaredOn,
  type FindingsDeclaration,
  type FindingsLedger,
  type FindingsRow,
  type JudgmentRow,
  type Standing,
  type StandingRow,
} from './types.js';

/** The scope surface this file needs. Structurally a `TypedScope<AgentState>`. */
export interface FindingsScope {
  findingsLedger?: FindingsLedger;
  $emit(name: string, payload?: unknown): void;
}

/**
 * One result a standing may name: an entry of the previous batch as
 * `AgentState.toolResults` holds it, or a served `role: 'tool'` message read
 * as one (`offer.ts · knownResults`). `toolName` is absent only for a served
 * message that carries none — never invented.
 */
export interface PreviousResult {
  readonly toolName?: string;
  readonly result: string;
  readonly toolCallId: string;
}

/** What `foldLedger` answers about a ledger. */
export interface LedgerFold {
  /** The LAST standing row per result id — the MODEL's current reading of each. */
  readonly standingOf: ReadonlyMap<string, StandingRow>;
  /**
   * The LAST judgment row per result id — the JUDGE's reading (9.104.0), a
   * second source kept apart: nothing here folds it into `standingOf`, and
   * `serve.ts` reads `standingOf` alone (policy A — the model's own standing
   * is what is served; docs/design/2026-09-findings-ledger.md § Judge).
   */
  readonly judgments: ReadonlyMap<string, JudgmentRow>;
  /** The assertions of the current `fact` rows, in fold order. */
  readonly asserted: readonly Assertion[];
  /** `conflictsOf(asserted)` — the current conflict set, not the rows' history. */
  readonly conflicts: readonly Conflict[];
  /** Whether any result has a standing at all. */
  readonly hasStanding: boolean;
}

// ─── The fold ──────────────────────────────────────────────────────────

/**
 * Fold a ledger to its current reading. Pure; safe on a spread of the
 * committed key (a TypedScope array read is a live proxy view — spread it
 * into a plain array before calling anything here).
 */
export function foldLedger(rows: readonly FindingsRow[]): LedgerFold {
  const standingOf = new Map<string, StandingRow>();
  const judgments = new Map<string, JudgmentRow>();
  for (const row of rows) {
    if (row.kind === 'standing') standingOf.set(row.toolCallId, row);
    else if (row.kind === 'judgment') judgments.set(row.toolCallId, row);
  }
  const asserted: Assertion[] = [];
  for (const row of standingOf.values()) {
    if (row.standing === 'fact') asserted.push(...row.assertions);
  }
  return {
    standingOf,
    judgments,
    asserted,
    conflicts: conflictsOf(asserted),
    hasStanding: standingOf.size > 0,
  };
}

/**
 * The witnesses of one conflict, identities only. Resolved by KEY over the
 * current fact rows rather than by reference: `conflictsOf` hands back the
 * objects it was given, but an element read off a TypedScope array is not
 * reference-stable, and a key is.
 */
function witnessesOf(conflict: Conflict, standingOf: ReadonlyMap<string, StandingRow>) {
  const witnesses: ConflictWitness[] = [];
  for (const row of standingOf.values()) {
    if (row.standing !== 'fact') continue;
    for (const a of row.assertions) {
      if (assertionKey(a) !== conflict.key) continue;
      witnesses.push({
        toolCallId: row.toolCallId,
        subject: { kind: a.subject.kind, id: a.subject.id },
        predicate: a.predicate,
      });
    }
  }
  return witnesses;
}

// ─── The writer ────────────────────────────────────────────────────────

/**
 * Append rows to the run's findings ledger, file a conflict row for every
 * key that first disagreed at this write, and emit one event per basis or
 * standing row. No-op on an empty list, so an armed agent whose model
 * declared nothing never writes the key — its commit log is the one it
 * always had. Callers pass basis and standing rows; conflict rows are this
 * function's to write.
 */
export function recordFindings(scope: FindingsScope, rows: readonly FindingsRow[]): void {
  if (rows.length === 0) return;
  // Spread into a plain local array first: a TypedScope array read is a live
  // deep-proxy view, and both the commit and the event payloads below must be
  // detached plain data (RFC-001 'clone' capture under deferred delivery).
  const prev: FindingsRow[] = [...((scope.findingsLedger as FindingsLedger | undefined) ?? [])];
  const merged: FindingsRow[] = [...prev, ...rows];
  const fold = foldLedger(merged);
  const alreadyFiled = new Set<string>();
  for (const row of merged) {
    if (row.kind === 'conflict') alreadyFiled.add(row.key);
  }
  const iteration = rows[rows.length - 1].iteration;
  const newConflicts: ConflictRow[] = fold.conflicts
    .filter((c) => !alreadyFiled.has(c.key))
    .map((c) => ({
      kind: 'conflict',
      key: c.key,
      witnesses: witnessesOf(c, fold.standingOf),
      iteration,
    }));
  scope.findingsLedger = [...merged, ...newConflicts];
  for (const row of rows) emitRow(scope, row, newConflicts, fold.judgments);
}

function emitRow(
  scope: FindingsScope,
  row: FindingsRow,
  newConflicts: readonly ConflictRow[],
  judgments: ReadonlyMap<string, JudgmentRow>,
) {
  if (row.kind === 'basis') {
    typedEmit(scope, 'agentfootprint.findings.declared', {
      toolName: row.toolName,
      toolCallId: row.toolCallId,
      iteration: row.iteration,
      basis: row.basis,
      ...(row.expect !== undefined && { expect: row.expect }),
      // A FLAG, never the text: the proposition is model prose and stays in
      // the committed key under the run's redaction (the payload law above).
      ...(row.proposition !== undefined && { hasProposition: true as const }),
      ...(row.malformed !== undefined && { malformed: row.malformed }),
    });
    return;
  }
  if (row.kind === 'judgment') {
    // No `agrees` here: the judge files BEFORE the next model call, so the
    // model's standing for this result cannot exist yet — the comparison is
    // made on the STANDING event below, where both readings exist.
    typedEmit(scope, 'agentfootprint.findings.judged', {
      toolCallId: row.toolCallId,
      toolName: row.toolName,
      iteration: row.iteration,
      against: row.against,
      standing: row.standing,
      confidence: row.confidence,
      latencyMs: row.latencyMs,
      ...(row.usage !== undefined && {
        inputTokens: row.usage.inputTokens,
        outputTokens: row.usage.outputTokens,
      }),
    });
    return;
  }
  if (row.kind === 'judgment-error') {
    typedEmit(scope, 'agentfootprint.findings.judge_failed', {
      toolCallId: row.toolCallId,
      toolName: row.toolName,
      iteration: row.iteration,
      ...(row.status !== undefined && { status: row.status }),
      latencyMs: row.latencyMs,
    });
    return;
  }
  if (row.kind === 'contingent') {
    // The VALUE stays on the row (the payload law): a sink learns which
    // moment used a value of what size, how many results carried it and
    // which standings they hold — never the token itself.
    const standings: Standing[] = [];
    for (const c of row.carriers) if (!standings.includes(c.standing)) standings.push(c.standing);
    typedEmit(scope, 'agentfootprint.findings.contingent', {
      iteration: row.iteration,
      declaredOn: row.declaredOn === 'answer' ? 'answer' : 'tool-call',
      ...(row.declaredOn !== 'answer' && { toolCallId: row.declaredOn.toolCallId }),
      carriers: row.carriers.length,
      standings,
      valueChars: row.value.length,
    });
    return;
  }
  if (row.kind !== 'standing') return;
  const conflictKeys = newConflicts
    .filter((c) => c.witnesses.some((w) => w.toolCallId === row.toolCallId))
    .map((c) => c.key);
  // The model's standing beside the judge's CURRENT judgment of the same
  // result (9.104.0) — `agrees` is a comparison made for the sink at the
  // one moment both readings exist (the judgment always lands first, before
  // the model call that declares), never written to a row: the two sources
  // stay two rows on the record (the second-source law). Absent when no
  // judgment exists — an unarmed run, a failed call, an unknown id.
  const judged = judgments.get(row.toolCallId);
  typedEmit(scope, 'agentfootprint.findings.standing', {
    toolCallId: row.toolCallId,
    ...(row.toolName !== undefined && { toolName: row.toolName }),
    iteration: row.iteration,
    standing: row.standing,
    declaredOn: row.declaredOn === 'answer' ? 'answer' : 'tool-call',
    assertionCount: row.assertions.length,
    ...(conflictKeys.length > 0 && { conflictKeys }),
    ...(row.unknownId === true && { unknownId: true }),
    ...(judged !== undefined && { agrees: judged.standing === row.standing }),
  });
}

// ─── Row builders ──────────────────────────────────────────────────────

/**
 * The ref a placed result lives at, or nothing. A guarded parse of a string
 * the library itself minted (`artifacts/placement.ts · placedToolResult`),
 * judged by `isPlacedToolResult` — a predicate, not inference.
 */
function placedRefOf(result: string): string | undefined {
  if (typeof result !== 'string' || result.trimStart()[0] !== '{') return undefined;
  try {
    const parsed: unknown = JSON.parse(result);
    return isPlacedToolResult(parsed) ? parsed.ref : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One standing row per `previous[]` entry of a declaration. Identity comes
 * from `known` by `toolCallId` — the results the run can identify, which the
 * two call sites (the dispatch loop, the route decider) build with
 * `offer.ts · knownResults`: the served history's tool messages plus the
 * previous batch, the SAME history the offer was read from, so every id the
 * offer listed resolves. An id `known` does not hold is filed with
 * `unknownId: true` and no `toolName` — never resolved by position or by
 * name. Assertions follow the stratum rule: `fact` → asserted,
 * `open` / `ruled-out` → quoted, `noise` → none; the provenance is
 * `tool:<toolCallId>`, or `artifact:<ref>` when the result was placed;
 * `epoch` is never set.
 */
export function standingRowsFrom(
  known: readonly PreviousResult[],
  declaration: FindingsDeclaration,
  declaredOn: DeclaredOn,
  iteration: number,
): StandingRow[] {
  const on: DeclaredOn = declaredOn === 'answer' ? 'answer' : { toolCallId: declaredOn.toolCallId };
  return (declaration.previous ?? []).map((entry) => {
    const found = known.find((r) => r.toolCallId === entry.toolCallId);
    const ref = found === undefined ? undefined : placedRefOf(found.result);
    const provenance = ref !== undefined ? `artifact:${ref}` : `tool:${entry.toolCallId}`;
    const stratum = entry.standing === 'fact' ? 'asserted' : 'quoted';
    const assertions: Assertion[] =
      entry.standing === 'noise'
        ? []
        : (entry.assertions ?? []).map((a) => ({
            subject: { kind: a.subject.kind, id: a.subject.id },
            predicate: a.predicate,
            value: a.value,
            stratum,
            provenance,
          }));
    return {
      kind: 'standing',
      toolCallId: entry.toolCallId,
      ...(found?.toolName !== undefined && { toolName: found.toolName }),
      ...(ref !== undefined && { ref }),
      standing: entry.standing,
      ...(entry.sought !== undefined && { sought: entry.sought }),
      ...(entry.settles !== undefined && { settles: entry.settles }),
      ...(entry.line !== undefined && { line: entry.line }),
      assertions,
      declaredOn: on,
      iteration,
      ...(found === undefined && { unknownId: true as const }),
    };
  });
}

/**
 * The basis row for one tool call. The declaration must carry a `basis` —
 * the dispatch loop files a row only when the model declared one, and a
 * caller that reaches here without one has broken that contract, which is
 * reported loudly rather than defaulted (never infer a basis).
 */
export function basisRowFrom(
  tc: { readonly id: string; readonly name: string },
  declaration: FindingsDeclaration,
  iteration: number,
  malformed?: number,
): BasisRow {
  if (declaration.basis === undefined) {
    throw new TypeError(
      `basisRowFrom: the declaration on '${tc.name}' (${tc.id}) carries no basis — file a ` +
        'basis row only when the model declared one.',
    );
  }
  return {
    kind: 'basis',
    toolCallId: tc.id,
    toolName: tc.name,
    iteration,
    basis: declaration.basis,
    ...(declaration.expect !== undefined && { expect: declaration.expect }),
    ...(declaration.proposition !== undefined && {
      proposition: clipText(declaration.proposition),
    }),
    ...(declaration.predicts !== undefined && { predicts: clipText(declaration.predicts) }),
    ...(malformed !== undefined && malformed > 0 && { malformed }),
  };
}

/**
 * The one cut a basis row's text gets: at most `PROPOSITION_CHARS`, the
 * overflow STATED in the text (`…[clipped N chars]`), the same statement
 * `serve.ts · clip` makes on a served line. Nothing is folded here — the row
 * keeps the model's newlines; the piece folds them when it quotes the line.
 */
function clipText(text: string): string {
  if (text.length <= PROPOSITION_CHARS) return text;
  return `${text.slice(0, PROPOSITION_CHARS)} …[clipped ${text.length - PROPOSITION_CHARS} chars]`;
}
