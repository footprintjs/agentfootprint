import type { AttemptCategory } from 'footprintjs';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { isPlaceholder } from '../../../redaction/marker.js';
import { historyCallResolver, readToolSettlements, type HistoryCall } from '../recordedCalls.js';
import type { CoverageRow } from './coverageRows.js';
import { readDeclaredWords } from './declaredWords.js';
import { REASONS } from './reasons.js';
import type { Gathered } from './gathered.js';
import { reasonSourceOf, type SourceRead } from './sources.js';
import type {
  AnswerAssessment,
  AssessmentPointer,
  AssessmentReason,
  AssessmentReasonDetail,
  AssessmentReasonSource,
  AssessmentToolWords,
} from './types.js';

const MAX_TOOL_WORDS_CHARS = 160;
const MAX_TOOL_WORDS_ENTRIES = 3;

export type RetainedReasonState = (
  key: 'coverageDeclared' | 'findingsLedger' | 'settledToolCalls',
  value: unknown,
) => unknown;

const TOOL_WORD_REASONS: ReadonlySet<AssessmentReason> = new Set([
  'coverage-gap',
  'declared-absent',
  'period-not-held',
  'period-partly-held',
  'period-unknown',
  'period-undeclared',
  'period-differs-from-asked',
  'period-beyond-retention',
]);

export function reasonUsesToolWords(reason: AssessmentReason): boolean {
  return TOOL_WORD_REASONS.has(reason);
}

/** A witness names an array entry by its own data slot, never by executing its reader. */
function rowIndex(path: string): number | undefined {
  const first = /^\/(0|[1-9]\d*)(?:\/|$)/.exec(path)?.[1];
  const index = Number(first);
  return Number.isSafeInteger(index) ? index : undefined;
}

function rowAt(rows: unknown, index: number | undefined): unknown {
  return Array.isArray(rows) && index !== undefined
    ? Object.getOwnPropertyDescriptor(rows, String(index))?.value
    : undefined;
}

interface DetailRead {
  readonly failureByHistory: ReadonlyMap<number, AttemptCategory>;
  readonly failureBySettlement: ReadonlyMap<number, AttemptCategory>;
  readonly wordsFor: (
    reason: AssessmentReason,
    witness: readonly AssessmentPointer[],
  ) => AssessmentToolWords | undefined;
}

/** Link only admitted declarations to an exact occurrence, never a reused provider id. */
function declaredWordsReader(
  coverage: readonly CoverageRow[],
  state: Readonly<Record<string, unknown>>,
  retained: RetainedReasonState,
): DetailRead['wordsFor'] {
  const words = retained('coverageDeclared', state.coverageDeclared);
  if (!Array.isArray(words)) return () => undefined;
  const byIndex = new Map<number, CoverageRow>();
  const byOccurrence = new Map<string, CoverageRow[]>();
  for (const row of coverage) {
    const key = row.occurrenceKey;
    const visible = rowAt(words, row.index);
    if (
      key === undefined ||
      visible === null ||
      typeof visible !== 'object' ||
      readCallOccurrenceKey(visible) !== key
    )
      continue;
    byIndex.set(row.index, row);
    const rows = byOccurrence.get(key);
    if (rows === undefined) byOccurrence.set(key, [row]);
    else rows.push(row);
  }
  let periods: { readonly rows: unknown } | undefined;
  return (reason, witness) => {
    const selected = new Set<number>();
    for (const pointer of witness) {
      if (pointer.kind !== 'state') continue;
      const index = rowIndex(pointer.path);
      if (index === undefined) continue;
      if (pointer.key === 'coverageDeclared') {
        if (byIndex.has(index)) selected.add(index);
      } else if (pointer.key === 'findingsLedger' && reason.startsWith('period-')) {
        periods ??= { rows: retained('findingsLedger', state.findingsLedger) };
        const row = rowAt(periods.rows, index);
        if (row === null || typeof row !== 'object') continue;
        if (Object.getOwnPropertyDescriptor(row, 'kind')?.value !== 'period') continue;
        const key = readCallOccurrenceKey(row);
        if (typeof key !== 'string') continue;
        for (const declaration of byOccurrence.get(key) ?? []) selected.add(declaration.index);
      }
    }
    const entries: AssessmentToolWords['entries'][number][] = [];
    const seen = new Set<string>();
    let remaining = MAX_TOOL_WORDS_CHARS;
    let omitted = 0;
    const add = (
      kind: AssessmentToolWords['entries'][number]['kind'],
      text: string,
      toolName?: string,
    ) => {
      const key = `${kind}:${text}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (text.length <= remaining && entries.length < MAX_TOOL_WORDS_ENTRIES) {
        entries.push({ kind, text, ...(toolName !== undefined && { toolName }) });
        remaining -= text.length;
      } else {
        omitted++;
      }
    };
    for (const index of selected) {
      const visible = rowAt(words, index);
      if (visible === null || typeof visible !== 'object') continue;
      const row = readDeclaredWords(visible);
      if (row === undefined) continue;
      const name = Object.getOwnPropertyDescriptor(visible, 'toolName')?.value as unknown;
      const toolName =
        typeof name === 'string' && name.length > 0 && name.length <= 128 && !isPlaceholder(name)
          ? name
          : undefined;
      if (reason !== 'declared-absent') {
        for (const kind of ['notChecked', 'cannotCover'] as const) {
          for (const text of row[kind].words) add(kind, text, toolName);
          omitted += row[kind].omitted;
        }
      }
      if (reason !== 'coverage-gap' && row.tryInstead !== undefined)
        add('tryInstead', row.tryInstead, toolName);
    }
    return entries.length > 0 || omitted > 0 ? { entries, omitted } : undefined;
  };
}

interface FailureSettlement {
  readonly index: number;
  readonly fact: { readonly outcome?: string; readonly failureCategory?: AttemptCategory };
}

function failureDetailsByWitness(
  calls: readonly HistoryCall[],
  settlements: ReadonlyMap<string, FailureSettlement> | undefined,
  retained: ReadonlyMap<string, FailureSettlement> | undefined,
): Pick<DetailRead, 'failureByHistory' | 'failureBySettlement'> {
  const failureByHistory = new Map<number, AttemptCategory>();
  const failureBySettlement = new Map<number, AttemptCategory>();
  if (settlements === undefined || retained === undefined) {
    return { failureByHistory, failureBySettlement };
  }
  const byKey = new Map<string, AttemptCategory>();
  for (const [key, { index, fact }] of settlements) {
    const visible = retained.get(key);
    if (
      fact.outcome !== 'failed' ||
      fact.failureCategory === undefined ||
      visible?.index !== index ||
      visible.fact.failureCategory !== fact.failureCategory
    )
      continue;
    byKey.set(key, fact.failureCategory);
    failureBySettlement.set(index, fact.failureCategory);
  }
  if (byKey.size > 0) {
    const resolve = historyCallResolver(calls);
    for (const [key, category] of byKey) {
      const match = resolve(undefined, undefined, key);
      if (match.kind === 'matched') failureByHistory.set(match.call.index, category);
    }
  }
  return { failureByHistory, failureBySettlement };
}

/** Read additional evidence only for reasons already established by the fold. */
export function readReasonDetails(
  g: Gathered,
  calls: readonly HistoryCall[],
  coverage: readonly CoverageRow[],
  state: Readonly<Record<string, unknown>>,
  settlements: ReadonlyMap<string, FailureSettlement> | undefined,
  retain: RetainedReasonState,
): DetailRead {
  const failures = g.fired.has('call-not-completed') ? settlements : undefined;
  const wordsFor = [...g.fired.keys()].some(reasonUsesToolWords)
    ? declaredWordsReader(coverage, state, retain)
    : () => undefined;
  const visible =
    failures === undefined
      ? undefined
      : readToolSettlements(retain('settledToolCalls', state.settledToolCalls), true)?.byKey;
  return { ...failureDetailsByWitness(calls, failures, visible), wordsFor };
}

function detailOf(
  reason: AssessmentReason,
  witness: readonly AssessmentPointer[],
  read: DetailRead,
): AssessmentReasonDetail | undefined {
  if (reasonUsesToolWords(reason)) {
    const toolSays = read.wordsFor(reason, witness);
    return toolSays === undefined ? undefined : { toolSays };
  }
  if (reason !== 'call-not-completed') return undefined;
  const categories = new Set<AttemptCategory>();
  for (const at of witness) {
    const index =
      at.kind === 'state' && at.key === 'settledToolCalls' ? rowIndex(at.path) : undefined;
    const category =
      at.kind === 'history'
        ? read.failureByHistory.get(at.index)
        : index === undefined
        ? undefined
        : read.failureBySettlement.get(index);
    if (category !== undefined) categories.add(category);
  }
  const [category] = categories;
  return categories.size === 1 && category !== undefined ? { category } : undefined;
}

/** Assemble the standing value and project only facts from the witnesses that fired. */
export function assessmentValueOf(
  g: Gathered,
  sourceRead: SourceRead,
  detailRead: DetailRead,
): Pick<AnswerAssessment, 'assessment' | 'reasons'> {
  const reasons = REASONS.flatMap((entry) => {
    const witness = g.fired.get(entry.reason);
    if (witness === undefined) return [];
    const kind: AssessmentReasonSource['kind'] =
      entry.reason === 'value-contingent' &&
      witness.some((w) => w.kind === 'state' && w.path.endsWith('/declaredOn'))
        ? 'answer'
        : entry.source;
    const detail = detailOf(entry.reason, witness, detailRead);
    return [
      {
        reason: entry.reason,
        ...(entry.layer !== undefined && { layer: entry.layer }),
        witness,
        source: reasonSourceOf(entry.reason, kind, witness, sourceRead),
        ...(detail !== undefined && { detail }),
      },
    ];
  });
  const assessment: AnswerAssessment['assessment'] =
    reasons.length > 0
      ? 'unknown'
      : g.support !== undefined
      ? 'known'
      : g.checked.some((c) => c.ran > 0)
      ? 'unrefuted'
      : 'not-applicable';
  return { assessment, reasons };
}
