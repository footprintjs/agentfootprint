/**
 * checkin — the evidence-carrying human-consent primitive.
 *
 * "OpenWorker-class agents check in; agentfootprint checks in WITH THE
 * RECEIPTS." A tool declares `checkIn` (see `Tool.checkIn` in `core/tools.ts`); when
 * it trips, the tool-dispatch loop pauses BEFORE executing and surfaces a
 * {@link CheckInRequest} — a typed ask that carries an EVIDENCE PACK
 * ({@link CheckInEvidence}): what the tool will do, what context the run
 * consumed, which context drove the choice, and a compact run-so-far trail.
 * A human answers with {@link checkInApproved} / {@link checkInDeclined};
 * the {@link CheckInDecision} lands as a typed record.
 *
 * This is the LEAF that owns every check-in TYPE + the pure assembly logic.
 * It has zero runtime/engine imports (only type-only imports of the message
 * shape + the influence-core attribution unit), so it stays cheap to import
 * and trivial to unit-test. The pause plumbing lives in
 * `core/agent/stages/toolCalls.ts`; the events in `events/`; the store in
 * `recorders/core/CheckInRecorder.ts`.
 *
 * NOT a policy engine (the `PermissionChecker` in `adapters/types.ts` is
 * untouched, and runs BEFORE this gate) and NOT UI. This asks a person to
 * CONSENT, with the receipts attached.
 *
 * Pattern: Strategy (pluggable evidence assembler + driver scorer) + pure
 *          value types. Every value here survives `structuredClone` + JSON
 *          (checkpoint discipline) — no functions, no class instances.
 */

import type { LLMMessage } from '../adapters/types.js';
import type { AttributionUnit } from '../lib/influence-core/types.js';

// ─── The ask ───────────────────────────────────────────────────────────

/**
 * The typed pause payload for one check-in. Rides the existing pause
 * machinery: it becomes the checkpoint's `pauseData` and is surfaced on
 * surfaced on `RunnerPauseOutcome.checkIn` (`core/pause.ts`). JSON/clone-safe.
 */
export interface CheckInRequest {
  /** The tool the agent wants to run (its name). */
  readonly tool: string;
  /** The arguments the model proposed for this call. */
  readonly args: Readonly<Record<string, unknown>>;
  /**
   * The model's stated reasoning for THIS call, when the assistant turn
   * carried text alongside the tool call. Omitted when the turn was a bare
   * tool call with no content.
   */
  readonly intent?: string;
  /** The receipts riding the ask. */
  readonly evidence: CheckInEvidence;
}

/**
 * The evidence pack — the "receipts". The `'minimal'` assembler fills only
 * {@link willDo} (zero cost); the `'standard'` assembler fills all four.
 */
export interface CheckInEvidence {
  /** Plain-words claim of what will happen: the tool description + the
   *  rendered arguments. Always present. */
  readonly willDo: string;
  /** What context this run consumed so far — one frame per context piece
   *  (system rules, the user task, prior tool results). Absent under the
   *  `'minimal'` assembler. */
  readonly read?: readonly CheckInContextFrame[];
  /** Which context drove THIS choice, ranked most-to-least. Produced by the
   *  configured {@link CheckInScorer} (default: a zero-LLM lexical scorer).
   *  Absent under the `'minimal'` assembler. */
  readonly drivers?: readonly CheckInDriver[];
  /** A compact grouped summary of the run so far. Absent under `'minimal'`. */
  readonly trail?: CheckInTrail;
}

/** One piece of context the run consumed — role/channel + a compact summary. */
export interface CheckInContextFrame {
  /** Origin group: `'system' | 'task' | 'result'`. */
  readonly channel: string;
  /** A short, truncated summary of the piece (never the full payload). */
  readonly summary: string;
}

/** One ranked driver — a context unit and how strongly it aligns with the pick. */
export interface CheckInDriver {
  /** The unit id (the citation, e.g. `'system-1'`). */
  readonly id: string;
  /** Origin group: `'system' | 'task' | 'result'`. */
  readonly channel: string;
  /** The unit text (quotable). */
  readonly text: string;
  /** Alignment score — higher means it drove the pick more. Scorer-defined
   *  units; compare within one request, not across scorers. */
  readonly score: number;
}

/** A compact grouped summary of the run so far. */
export interface CheckInTrail {
  /** Which ReAct iteration this check-in fired on. */
  readonly iteration: number;
  /** The tool calls already completed this run, oldest first. */
  readonly toolCalls: readonly { readonly name: string; readonly ok: boolean }[];
  /** One-line human summary, e.g. `"3 tools run over 2 iterations"`. */
  readonly summary: string;
}

// ─── The decision ──────────────────────────────────────────────────────

/**
 * The human's answer to a check-in — the record that lands. Produced by
 * {@link checkInApproved} / {@link checkInDeclined} and passed to
 * `agent.resume(checkpoint, decision)`. JSON/clone-safe.
 */
export interface CheckInDecision {
  /** True to run the tool, false to decline it. */
  readonly approved: boolean;
  /** Who decided (an operator id, an email, a queue name — your call). */
  readonly by: string;
  /** Optional note. On decline it is surfaced to the model so it can adapt. */
  readonly note?: string;
  /** When the decision was made (ms since epoch). */
  readonly at: number;
}

/** Options for {@link checkInApproved} / {@link checkInDeclined}. */
export interface CheckInDecisionInput {
  /** Who decided. */
  readonly by: string;
  /** Optional free-text note. */
  readonly note?: string;
}

/**
 * Approve a pending check-in — the paused tool executes normally on resume.
 *
 * @example
 *   const decision = checkInApproved({ by: 'alice@ops', note: 'verified with customer' });
 *   const final = await agent.resume(outcome.checkpoint, decision);
 */
export function checkInApproved(input: CheckInDecisionInput): CheckInDecision {
  return { approved: true, by: input.by, at: Date.now(), ...(input.note && { note: input.note }) };
}

/**
 * Decline a pending check-in — the tool is NOT executed; the model receives
 * a `"declined by human: <note>"` tool result and adapts in-loop.
 *
 * @example
 *   const decision = checkInDeclined({ by: 'alice@ops', note: 'amount too high' });
 *   const final = await agent.resume(outcome.checkpoint, decision);
 */
export function checkInDeclined(input: CheckInDecisionInput): CheckInDecision {
  return { approved: false, by: input.by, at: Date.now(), ...(input.note && { note: input.note }) };
}

/**
 * Type guard — is this resume input a {@link CheckInDecision}? Distinguishes
 * a check-in answer from a plain `askHuman` tool-result value.
 */
export function isCheckInDecision(x: unknown): x is CheckInDecision {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as CheckInDecision).approved === 'boolean' &&
    typeof (x as CheckInDecision).by === 'string'
  );
}

// ─── The declarative demand (per-tool) ─────────────────────────────────

/**
 * What a tool declares to demand a check-in. `'always'` trips on every call;
 * a predicate trips selectively (e.g. only high-value refunds). A predicate
 * that throws trips (fail toward asking the human — consequential actions
 * should not silently proceed on a buggy predicate).
 */
export type CheckInDemand<TArgs = Readonly<Record<string, unknown>>> =
  | 'always'
  | ((args: TArgs, ctx: CheckInPredicateContext) => boolean);

/** Context handed to a {@link CheckInDemand} predicate. */
export interface CheckInPredicateContext {
  /** The current ReAct iteration. */
  readonly iteration: number;
  /** This tool invocation's id. */
  readonly toolCallId: string;
  /** The conversation so far (system, user, prior tool results). */
  readonly history: readonly LLMMessage[];
}

/**
 * Decide whether a tool's declared demand trips for this call. Returns false
 * when the tool declared no `checkIn` (backward-compatible: byte-identical
 * behavior for tools without the field).
 */
export function shouldCheckIn(
  demand: CheckInDemand<Readonly<Record<string, unknown>>> | undefined,
  args: Readonly<Record<string, unknown>>,
  ctx: CheckInPredicateContext,
): boolean {
  if (demand === undefined) return false;
  if (demand === 'always') return true;
  try {
    return demand(args, ctx) === true;
  } catch {
    // A buggy predicate must not let a consequential action slip through
    // unreviewed — fail toward asking the human.
    return true;
  }
}

// ─── The pluggable scorer (drivers) ────────────────────────────────────

/** Input to a {@link CheckInScorer}. Mirrors `influence-core`'s attribution
 *  shape so an embedding-backed scorer (wrapping `explainChoice`) drops in. */
export interface CheckInScoreInput {
  /** The chosen tool. `text` is what gets scored (name + description + args). */
  readonly tool: { readonly name: string; readonly text: string };
  /** The context units to rank against the tool. */
  readonly units: readonly AttributionUnit[];
  /** Abort signal for network-backed scorers. */
  readonly signal?: AbortSignal;
}

/**
 * Ranks context units by how strongly each drove one tool choice. The
 * DEFAULT is {@link lexicalDriverScorer} — deterministic, zero LLM, zero
 * network. Swap in a richer one via `.checkIn({ scorer })`, e.g. wrapping
 * `explainChoice` from `agentfootprint` with your own embedder.
 *
 * @example a semantic scorer
 *   const scorer: CheckInScorer = async ({ tool, units, signal }) => {
 *     const ex = await explainChoice({ tool, units, embedder, signal });
 *     return ex.units.map((u) => ({ id: u.id, channel: u.channel, text: u.text, score: u.score }));
 *   };
 */
export type CheckInScorer = (
  input: CheckInScoreInput,
) => readonly CheckInDriver[] | Promise<readonly CheckInDriver[]>;

const WORD_RE = /[a-z0-9]+/g;
const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'this',
  'that',
  'it',
  'as',
  'at',
  'by',
  'be',
  'you',
  'your',
  'i',
]);

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(lower))) {
    if (m[0].length > 1 && !STOP.has(m[0])) out.add(m[0]);
  }
  WORD_RE.lastIndex = 0;
  return out;
}

/**
 * The default drivers scorer: deterministic Jaccard token overlap between
 * the tool text and each context unit. Zero LLM, zero network, structuredClone
 * -safe output. Ties keep input order (stable sort).
 */
export const lexicalDriverScorer: CheckInScorer = ({ tool, units }) => {
  const toolTokens = tokenize(tool.text);
  const scored = units.map((u) => {
    const unitTokens = tokenize(u.text);
    let shared = 0;
    for (const t of unitTokens) if (toolTokens.has(t)) shared++;
    const union = toolTokens.size + unitTokens.size - shared;
    const score = union === 0 ? 0 : shared / union;
    return { id: u.id, channel: u.channel, text: u.text, score };
  });
  // Stable descending sort — Array.prototype.sort is stable in modern engines.
  return scored.sort((a, b) => b.score - a.score);
};

// ─── The pluggable evidence assembler ──────────────────────────────────

/** Everything the assembler needs to build one evidence pack. */
export interface CheckInAssemblerInput {
  /** The chosen tool — `name` for citations, `description` for `willDo`. */
  readonly tool: { readonly name: string; readonly description: string };
  /** The proposed arguments. */
  readonly args: Readonly<Record<string, unknown>>;
  /** The model's stated reasoning, if any (assistant-turn text). */
  readonly intent?: string;
  /** The ReAct iteration this check-in fired on. */
  readonly iteration: number;
  /** The conversation so far — the raw material for `read`, `drivers`, `trail`. */
  readonly history: readonly LLMMessage[];
  /** The scorer to rank `drivers` with. */
  readonly scorer: CheckInScorer;
  /** Abort signal threaded to the scorer. */
  readonly signal?: AbortSignal;
}

/**
 * Builds the evidence pack for one check-in. Two are built in
 * ({@link standardEvidenceAssembler}, {@link minimalEvidenceAssembler});
 * pass your own to `.checkIn({ evidence })` for full control.
 */
export type CheckInAssembler = (
  input: CheckInAssemblerInput,
) => CheckInEvidence | Promise<CheckInEvidence>;

/** Which built-in assembler to use, by name. */
export type EvidencePreset = 'minimal' | 'standard';

const MAX_SUMMARY = 160;

function truncate(s: string, max = MAX_SUMMARY): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Render args as a compact `k=v, k=v` string (values truncated, clone-safe). */
function renderArgs(args: Readonly<Record<string, unknown>>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const val =
      typeof v === 'string' ? v : v === null || v === undefined ? String(v) : JSON.stringify(v);
    return `${k}=${truncate(val, 60)}`;
  });
  return parts.join(', ');
}

/** Plain-words "what will happen" claim. */
function buildWillDo(
  tool: { readonly name: string; readonly description: string },
  args: Readonly<Record<string, unknown>>,
): string {
  const desc = tool.description.trim() || tool.name;
  const rendered = renderArgs(args);
  return rendered ? `${desc} — with ${rendered}` : desc;
}

/**
 * Derive attribution units from the run-so-far conversation: system rules
 * (split into sentences), the user task, and prior tool results. These feed
 * BOTH `read` (as frames) and `drivers` (scored). Ids are unique + stable.
 */
export function unitsFromHistory(history: readonly LLMMessage[]): AttributionUnit[] {
  const units: AttributionUnit[] = [];
  let sysN = 0;
  let taskN = 0;
  let resN = 0;
  for (const m of history) {
    const content = (m.content ?? '').trim();
    if (!content) continue;
    if (m.role === 'system') {
      // Split the system prompt into rule-sized units so a single rule can be
      // cited. Sentence-ish split; keep non-empty pieces.
      for (const piece of content.split(/(?<=[.!?])\s+|\n+/)) {
        const t = piece.trim();
        if (t) units.push({ id: `system-${++sysN}`, channel: 'system', text: t });
      }
    } else if (m.role === 'user') {
      units.push({ id: `task-${++taskN}`, channel: 'task', text: content });
    } else if (m.role === 'tool') {
      units.push({
        id: `result-${++resN}`,
        channel: 'result',
        text: m.toolName ? `${m.toolName}: ${content}` : content,
      });
    }
  }
  return units;
}

function framesFromUnits(units: readonly AttributionUnit[]): CheckInContextFrame[] {
  return units.map((u) => ({ channel: u.channel, summary: truncate(u.text) }));
}

function buildTrail(history: readonly LLMMessage[], iteration: number): CheckInTrail {
  const toolCalls: { name: string; ok: boolean }[] = [];
  for (const m of history) {
    if (m.role === 'tool' && m.toolName) {
      // A tool result whose content advertises an error is marked not-ok. The
      // synthetic strings the loop writes ("[permission denied…]", "declined by
      // human…", "credential error…") all read as failures here.
      const c = (m.content ?? '').toLowerCase();
      const ok = !(
        c.startsWith('[permission denied') ||
        c.startsWith('declined by human') ||
        c.startsWith('credential error') ||
        c.startsWith('authorization required')
      );
      toolCalls.push({ name: m.toolName, ok });
    }
  }
  const summary =
    toolCalls.length === 0
      ? `no tools run yet (iteration ${iteration})`
      : `${toolCalls.length} tool${
          toolCalls.length === 1 ? '' : 's'
        } run over ${iteration} iteration${iteration === 1 ? '' : 's'}`;
  return { iteration, toolCalls, summary };
}

/**
 * The `'standard'` assembler — fills all four evidence fields. The `drivers`
 * ranking runs the configured scorer over the run-so-far context units; the
 * default scorer is deterministic and makes zero LLM/network calls.
 */
export const standardEvidenceAssembler: CheckInAssembler = async (input) => {
  const { tool, args, iteration, history, scorer, signal } = input;
  const units = unitsFromHistory(history);
  const willDo = buildWillDo(tool, args);
  const read = framesFromUnits(units);
  const trail = buildTrail(history, iteration);
  let drivers: readonly CheckInDriver[] = [];
  if (units.length > 0) {
    const toolText = `${tool.name} ${tool.description} ${renderArgs(args)}`.trim();
    drivers = await scorer({
      tool: { name: tool.name, text: toolText },
      units,
      ...(signal && { signal }),
    });
  }
  return { willDo, read, drivers, trail };
};

/** The `'minimal'` assembler — only `willDo`. Zero cost; no scorer call. */
export const minimalEvidenceAssembler: CheckInAssembler = (input) => ({
  willDo: buildWillDo(input.tool, input.args),
});

// ─── Config resolution (builder → runtime) ─────────────────────────────

/** What `.checkIn({...})` accepts on the Agent builder. */
export interface CheckInBuilderOptions {
  /**
   * How much evidence rides the ask. `'standard'` (default) fills all four
   * fields; `'minimal'` fills only `willDo` (zero cost); or pass your own
   * {@link CheckInAssembler}.
   */
  readonly evidence?: EvidencePreset | CheckInAssembler;
  /**
   * The scorer that ranks `drivers`. Default {@link lexicalDriverScorer}
   * (deterministic, zero LLM). Only consulted by the `'standard'` assembler.
   */
  readonly scorer?: CheckInScorer;
}

/** The resolved config threaded into the tool-dispatch handler. */
export interface ResolvedCheckInConfig {
  readonly assembler: CheckInAssembler;
  readonly scorer: CheckInScorer;
}

/**
 * Resolve builder options (or nothing) into a runtime config. The default —
 * `standard` evidence + `lexicalDriverScorer` — makes a tool that declares
 * `checkIn` work even when the builder never called `.checkIn()`.
 */
export function resolveCheckInConfig(opts?: CheckInBuilderOptions): ResolvedCheckInConfig {
  // 8.13.0 — a scorer that will never be called is refused, not resolved.
  // `minimalEvidenceAssembler` builds only `willDo`; the scorer's whole job is
  // ranking `drivers`, which the minimal pack does not have. Configured and
  // inert looks exactly like configured and working.
  //
  // Only the literal `'minimal'` PRESET is refused. A custom assembler is handed
  // the scorer in its input and may legitimately call it, so the library cannot
  // judge that pairing — and refusing what it cannot judge would be a guess.
  if (opts?.scorer !== undefined && opts.evidence === 'minimal') {
    throw new Error(
      "AgentBuilder.checkIn: `scorer` has no effect with `evidence: 'minimal'`. The scorer " +
        'ranks the `drivers` field — which context drove this tool choice — and the minimal ' +
        'assembler builds only `willDo`, so the scorer is resolved and then never called. Use ' +
        "`evidence: 'standard'` to get the drivers, or drop the `scorer`.",
    );
  }
  const scorer = opts?.scorer ?? lexicalDriverScorer;
  const evidence = opts?.evidence ?? 'standard';
  const assembler: CheckInAssembler =
    evidence === 'standard'
      ? standardEvidenceAssembler
      : evidence === 'minimal'
      ? minimalEvidenceAssembler
      : evidence;
  return { assembler, scorer };
}
