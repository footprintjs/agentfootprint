/**
 * honesty/sourceCorpus — the calls' declared sources (`declaredSourcesOf`) and
 * the corpora the inputs layer's checks read (`sourceCorpusOf`), built from
 * the batch and the pieces the mount handed in.
 *
 * Pattern: one pure builder. Every corpus is read the way its one owner reads
 * it: the person's messages through `lib/saidByPerson.ts` · `isSaidByPerson`,
 * a result through `findings/offer.ts` · `isResultMessage` and its TOOL bytes
 * through `lib/toolBytes.ts` · `toolBytesOf`, the model's current standing
 * through `findings/ledger.ts` · `foldLedger`, this batch's own standings
 * through `findings/reserved.ts` · `readDeclaration`.
 * Role:    core/agent/honesty — the one module on the layer's side that may
 *          import BOTH `findings/` and `arguments/` (the one-way law keeps
 *          `arguments/` a leaf). Loaded through `import()` by the mount's
 *          closures on first use (`mounts.ts` · `buildInputsSubflow`), only
 *          under `.findings({ argumentSources: true })` — never on a plain
 *          agent's graph.
 * Emits:   N/A.
 *
 * ## What counts, and what never does
 *
 * - **The person's words**: every served message a person wrote, the current
 *   request included, within the window. In a COMPOSED run
 *   (`AgentInput.messageFrom: 'composed'`) the run's own message is marked:
 *   it is another runner's output, never the person's.
 * - **A result**: its tool's own bytes, cut at the tool-bytes boundary, so a
 *   library note never speaks for the tool; an id known only through the
 *   previous batch has no cut to read through and carries no text.
 * - **The app's text**: `role: 'system'` history messages, the composed
 *   system prompt's records (raw content, or the summary a redacted record
 *   carries — the evidence gate's own reach, which includes memory recall and
 *   retrieval passages, adopted Q15), and the app's `externalGrounds` with
 *   their labels. The library's own always-on instructions (the findings
 *   ledger's, the ontology's) are left out: library text is never evidence.
 * - **The person's answers**: the ledger's `answered` argument rows — the
 *   ask writes no message, so they live on the ledger, and compaction never
 *   evicts them.
 * - **Assistant text** only to say a value was found nowhere else.
 */

import type { LLMMessage, LLMToolSchema } from '../../../adapters/types.js';
import type { ExternalGround } from '../../../integrity/unsupported-argument/check.js';
import { isSaidByPerson } from '../../../lib/saidByPerson.js';
import { toolBytesOf } from '../../../lib/toolBytes.js';
import { ONTOLOGY_INSTRUCTION_ID } from '../../../ontology/instruction.js';
import type {
  AppWords,
  EarlierAnswer,
  PersonWords,
  ServedResult,
  SourceCorpus,
} from '../arguments/checks.js';
import { isRefused, rulesOf } from '../arguments/declare.js';
import type { BatchCall, ToolOf } from '../arguments/resolve.js';
import type { CallSources } from '../arguments/sources.js';
import type { SourceInputs } from '../arguments/subflow.js';
import { foldLedger } from '../findings/ledger.js';
import { isResultMessage } from '../findings/offer.js';
import {
  FINDINGS_INSTRUCTION_ID,
  ownsReservedArgument,
  readDeclaration,
} from '../findings/reserved.js';
import {
  RESERVED_ARGUMENT,
  type FindingsRow,
  type Standing,
  type StandingRow,
} from '../findings/types.js';

type PlainObject = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMessage = (value: unknown): value is LLMMessage =>
  isRecord(value) && typeof value.role === 'string' && typeof value.content === 'string';

/** The library's own always-on instructions — never the app's text. */
const LIBRARY_INSTRUCTIONS: ReadonlySet<string> = new Set([
  FINDINGS_INSTRUCTION_ID,
  ONTOLOGY_INSTRUCTION_ID,
]);

/** The index of the current request — the last message a person said; `-1` when none is. */
function currentRequestOf(history: readonly LLMMessage[]): number {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (isSaidByPerson(history[i])) return i;
  }
  return -1;
}

function personWordsOf(
  history: readonly LLMMessage[],
  current: number,
  composed: boolean,
): PersonWords[] {
  const out: PersonWords[] = [];
  history.forEach((m, i) => {
    if (!isSaidByPerson(m)) return;
    out.push({
      text: m.content,
      ...(i < current && { earlier: true as const }),
      ...(composed && i === current && { composed: true as const }),
    });
  });
  return out;
}

/**
 * The model's CURRENT standing on each result — the ledger's fold plus the
 * standings this batch's own `_findings.previous[]` declares, in batch order
 * (the contingent law at dispatch counts a standing declared on the same
 * batch; ToolCalls files them a moment later). Computed in memory, never
 * filed.
 */
function standingsOf(
  ledger: readonly unknown[] | undefined,
  calls: readonly BatchCall[],
  toolOf: ToolOf,
): Map<string, Standing> {
  const rows = (ledger ?? []).filter(
    (row): row is StandingRow => isRecord(row) && row.kind === 'standing',
  );
  const standings = new Map<string, Standing>();
  for (const [id, row] of foldLedger(rows as readonly FindingsRow[]).standingOf) {
    standings.set(id, row.standing);
  }
  for (const call of calls) {
    if (ownsReservedArgument(toolOf(call.name)?.schema as LLMToolSchema | undefined)) continue;
    const raw = (call.args as PlainObject)[RESERVED_ARGUMENT];
    if (raw === undefined) continue;
    for (const entry of readDeclaration(raw).declaration?.previous ?? []) {
      standings.set(entry.toolCallId, entry.standing);
    }
  }
  return standings;
}

function servedResultsOf(
  history: readonly LLMMessage[],
  current: number,
  standings: ReadonlyMap<string, Standing>,
  previousBatch: SourceInputs['previousBatch'],
): ServedResult[] {
  const out: ServedResult[] = [];
  const seen = new Set<string>();
  history.forEach((m, i) => {
    const id = m.toolCallId;
    if (!isResultMessage(m) || id === undefined || id.length === 0 || seen.has(id)) return;
    seen.add(id);
    const standing = standings.get(id);
    out.push({
      toolCallId: id,
      ...(m.toolName !== undefined && { toolName: m.toolName }),
      text: toolBytesOf(m),
      ...(i < current && { earlier: true as const }),
      ...(standing !== undefined && { standing }),
    });
  });
  // An id the previous batch landed but the served window no longer holds: known, with
  // no cut to read its bytes through — a claim on it is `uncheckable`, never "found".
  for (const r of previousBatch ?? []) {
    if (seen.has(r.toolCallId)) continue;
    seen.add(r.toolCallId);
    const standing = standings.get(r.toolCallId);
    out.push({
      toolCallId: r.toolCallId,
      ...(r.toolName !== undefined && { toolName: r.toolName }),
      ...(standing !== undefined && { standing }),
    });
  }
  return out;
}

/** The app's `externalGrounds`, read as the choice seam reads them: a failing provider adds nothing. */
function groundsOf(provider: (() => readonly ExternalGround[]) | undefined): AppWords[] {
  if (provider === undefined) return [];
  let entries: unknown;
  try {
    entries = provider();
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  const out: AppWords[] = [];
  for (const e of entries) {
    if (!isRecord(e) || typeof e.value !== 'string' || typeof e.source !== 'string') continue;
    if (e.value.trim() === '' || e.source.trim() === '') continue;
    out.push({ text: e.value, label: e.source });
  }
  return out;
}

function appWordsOf(
  history: readonly LLMMessage[],
  injections: readonly unknown[] | undefined,
  externalGrounds: (() => readonly ExternalGround[]) | undefined,
): AppWords[] {
  const out: AppWords[] = [];
  for (const m of history) if (m.role === 'system') out.push({ text: m.content });
  for (const rec of injections ?? []) {
    if (!isRecord(rec)) continue;
    const id = typeof rec.sourceId === 'string' ? rec.sourceId : undefined;
    if (rec.source === 'instructions' && id !== undefined && LIBRARY_INSTRUCTIONS.has(id)) continue;
    const text =
      typeof rec.rawContent === 'string'
        ? rec.rawContent
        : typeof rec.contentSummary === 'string'
        ? rec.contentSummary
        : undefined;
    if (text !== undefined && text !== '') out.push({ text });
  }
  out.push(...groundsOf(externalGrounds));
  return out;
}

/** The names of the tools the served history's assistant turns called, each once. */
function calledToolsOf(history: readonly LLMMessage[]): string[] {
  const names = new Set<string>();
  for (const m of history) {
    if (m.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue;
    for (const call of m.toolCalls) if (typeof call?.name === 'string') names.add(call.name);
  }
  return [...names];
}

/** The person's earlier answers to the library's ask — the ledger's `answered` argument rows. */
function answersOf(ledger: readonly unknown[] | undefined, toolOf: ToolOf): EarlierAnswer[] {
  const out: EarlierAnswer[] = [];
  for (const row of ledger ?? []) {
    if (!isRecord(row) || row.kind !== 'argument' || row.source !== 'answered') continue;
    const { toolName, argument, value, turn } = row;
    if (typeof toolName !== 'string' || typeof argument !== 'string') continue;
    if (typeof value !== 'string' || typeof turn !== 'number') continue;
    const period = row.period === true;
    const rules = period ? rulesOf(toolOf(toolName)) : undefined;
    const spelling = rules !== undefined && !isRefused(rules) ? rules.period?.spelling : undefined;
    out.push({
      toolName,
      argument,
      value,
      turn,
      ...(period && { period: true as const }),
      ...(spelling !== undefined && { spelling }),
    });
  }
  return out;
}

/**
 * Each call's declared sources, through the ONE reader of `_findings`
 * (`findings/reserved.ts` · `readDeclaration`, under the sources arm), judged
 * against the call's own arguments. A call whose tool OWNS the reserved
 * argument declares nothing and gets no entry; a call with no `_findings`
 * declares an empty `from`. The dropped entries' count rides only when the
 * call files no basis row (that row carries it otherwise).
 */
export function declaredSourcesOf(
  calls: readonly BatchCall[],
  toolOf: ToolOf,
): readonly CallSources[] {
  const out: CallSources[] = [];
  for (const call of calls) {
    const tool = toolOf(call.name);
    if (ownsReservedArgument(tool?.schema as LLMToolSchema | undefined)) continue;
    const args = call.args as PlainObject;
    if (!Object.prototype.hasOwnProperty.call(args, RESERVED_ARGUMENT)) {
      out.push({ toolCallId: call.id, from: [] });
      continue;
    }
    const { [RESERVED_ARGUMENT]: raw, ...rest } = args;
    const read = readDeclaration(raw, { argumentSources: true }, rest);
    const malformed =
      read.declaration?.basis === undefined && (read.sourcesMalformed ?? 0) > 0
        ? read.sourcesMalformed
        : undefined;
    out.push({
      toolCallId: call.id,
      from: read.declaration?.from ?? [],
      ...(malformed !== undefined && { malformed }),
    });
  }
  return out;
}

// FOLD · the one owner of the corpora the declared-sources checks read
// consumers read this and never re-derive it: arguments/checks.ts · checkSource, handed the corpus by the
// layer's VERIFY stage (arguments/subflow.ts · verifyArgumentsStage) through the mount's closure.
// detached: yes — built per batch from plain copies of committed state; never stored.
/**
 * The corpora the declared-sources checks read, for one batch — built from
 * the raw pieces the mount handed in (`SourceInputs`), the batch itself (its
 * own `previous[]` standings) and the app's `externalGrounds`.
 */
export function sourceCorpusOf(
  inputs: SourceInputs,
  calls: readonly BatchCall[],
  turn: number,
  deps: {
    readonly toolOf: ToolOf;
    readonly externalGrounds?: () => readonly ExternalGround[];
  },
): SourceCorpus {
  const history = inputs.history.filter(isMessage);
  const current = currentRequestOf(history);
  const calledTools = calledToolsOf(history);
  return {
    turn,
    person: personWordsOf(history, current, inputs.composed === true),
    results: servedResultsOf(
      history,
      current,
      standingsOf(inputs.ledger, calls, deps.toolOf),
      inputs.previousBatch,
    ),
    assistant: history
      .filter((m) => m.role === 'assistant' && m.content.trim() !== '')
      .map((m) => m.content),
    app: appWordsOf(history, inputs.systemPromptInjections, deps.externalGrounds),
    answers: answersOf(inputs.ledger, deps.toolOf),
    ...(calledTools.length > 0 && { calledTools }),
  };
}
