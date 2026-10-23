/** Runtime admission and delivery for typed negative citations. The pure checker
 * compares reads; this boundary additionally binds every citation to this app's
 * admitted dispatches and trusted caller context. Model text is never evidence. */
import { MAX_NEGATIVE_CLAIMS } from '../../../integrity/negative-claim/limits.js';
import { judgeTypedNegatives } from '../../../integrity/negative-claim/judge.js';
import { sameValue, scopeOf, returnedReading } from '../../../integrity/negative-claim/readings.js';
import {
  composeRecordedStatement,
  STATEMENT_VERSION,
} from '../../../integrity/negative-claim/statement.js';
import type {
  TurnCall,
  TurnRecord,
  TypedNegativeRow,
} from '../../../integrity/negative-claim/types.js';
import type { AnswerCheck, AnswerValidationReport } from '../../../answer-validation/types.js';
import { copyJson } from '../../../lib/boundedJson.js';

export interface NegativeDeliveryConfig {
  readonly field: string;
  readonly tools: readonly string[];
  readonly unestablished: 'withhold' | 'state-searched';
}
export type RuntimeNegativeCode =
  | TypedNegativeRow['code']
  | 'outside-trusted-context'
  | 'other-read-has-rows';
export interface RuntimeNegativeRow extends Omit<TypedNegativeRow, 'code' | 'disposition'> {
  readonly code: RuntimeNegativeCode;
  readonly disposition: 'checked-fail' | 'not-applicable' | 'unreachable';
}
export interface DeliveredNegative {
  readonly kind: 'none' | 'not-found' | 'complete' | 'unknown';
  readonly about?: string | number;
  readonly restsOn: readonly string[];
  readonly statement: string;
  readonly delivery: 'record-composed';
  readonly version: string;
}
export type AnswerNegatives = import('../../../events/payloads.js').AnswerNegativesPayload;
const HANDLE = /^r[1-9][0-9]{0,3}$/;
const own = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const aboutFits = (about: unknown, call: TurnCall): boolean =>
  (scopeOf(call) ?? []).some(
    (item) =>
      item.facet === 'population' &&
      [item.value, item.resolved?.id, item.resolved?.name, ...(item.resolved?.aliases ?? [])].some(
        (value) => value !== undefined && sameValue(value, about),
      ),
  );
const subject = (call: TurnCall): unknown =>
  (scopeOf(call) ?? []).find((item) => item.facet === 'subject')?.what;

/** Only an explicit field on every observed row proves a peer outside scope.
 * An unknown row shape, missing field or unscoped reading is conservative. */
function rowsOutside(other: TurnCall, cited: TurnCall): boolean {
  const rows = other.rowsRead;
  if (!rows?.length || rows.length < (other.rows ?? rows.length)) return false;
  const filters = (scopeOf(cited) ?? []).filter(
    (item) =>
      item.facet === 'filter' &&
      item.from !== 'host' &&
      item.any !== true &&
      item.argument !== undefined &&
      item.value !== undefined,
  );
  return rows.every((row) =>
    filters.some(
      (item) => Object.hasOwn(row, item.argument!) && !sameValue(row[item.argument!], item.value),
    ),
  );
}

export function renderNegativeCandidate(
  candidate: unknown,
  config: NegativeDeliveryConfig,
  record: TurnRecord,
  trusted: (call: TurnCall) => boolean,
): { candidate: unknown; answer: AnswerNegatives; correction: boolean; allowed: boolean } {
  const source = copyJson(candidate, 1024 * 1024, false);
  if (!own(source)) throw new Error('A negative-claims answer must be a JSON object.');
  const entries = source[config.field];
  const validList = Array.isArray(entries) && entries.length <= MAX_NEGATIVE_CLAIMS;
  // Bound before the pure checker maps entries; malformed/missing is a real
  // unreachable check, whereas an explicit empty array makes no assertion.
  const rawEntries: unknown[] = validList ? entries : [undefined];
  const judgments = judgeTypedNegatives({
    field: config.field,
    negatives: rawEntries,
    record,
    citable: config.tools,
  });
  const checks: RuntimeNegativeRow[] = [];
  const claims: DeliveredNegative[] = [];
  let correction = false;
  for (let i = 0; i < judgments.length; i++) {
    const raw = rawEntries[i];
    const entry = own(raw) ? raw : {};
    const refs = Array.isArray(entry.restsOn) ? entry.restsOn : [];
    const about = entry.about;
    const validAbout =
      (typeof about === 'string' && about.trim().length > 0 && about.length <= 256) ||
      (typeof about === 'number' && Number.isFinite(about));
    const validShape =
      validList &&
      own(raw) &&
      validAbout &&
      refs.length > 0 &&
      refs.length <= 16 &&
      refs.every((ref) => typeof ref === 'string' && HANDLE.test(ref)) &&
      Object.keys(entry).every((key) => ['kind', 'about', 'restsOn'].includes(key));
    const reads = refs.flatMap((ref) => record.calls.filter((call) => call.row?.handle === ref));
    let row = judgments[i].row as RuntimeNegativeRow;
    const fail = (
      code: RuntimeNegativeCode,
      disposition: 'unreachable' | 'checked-fail' = 'unreachable',
    ) => {
      row = { ...row, code, disposition };
    };
    if (!validList)
      fail(
        Array.isArray(entries) && entries.length > MAX_NEGATIVE_CLAIMS
          ? 'too-many-claims'
          : 'citation-unresolved',
      );
    else if (!validShape) fail('citation-unresolved');
    else if (row.code === 'established') {
      if (reads.length === 0 || !reads.every((call) => aboutFits(about, call)))
        fail('about-mismatch');
      else if (!reads.every(trusted)) fail('outside-trusted-context');
      else if (
        record.calls.some(
          (other) =>
            other.turn === record.turn &&
            returnedReading(other) &&
            other.emptiness === 'non-empty' &&
            reads.some(
              (cited) =>
                other.resultId !== cited.resultId &&
                subject(cited) !== undefined &&
                sameValue(subject(other), subject(cited)) &&
                aboutFits(about, other) &&
                !rowsOutside(other, cited),
            ),
        )
      )
        fail('other-read-has-rows', 'checked-fail');
    }
    // Even a failing citation must not use another caller's scope in a fallback.
    const canDescribe =
      validShape &&
      reads.length > 0 &&
      reads.every(
        (call) =>
          trusted(call) &&
          aboutFits(about, call) &&
          call.turn === record.turn &&
          call.row?.composed === 'local' &&
          call.keptOut !== true,
      );
    const established = row.code === 'established';
    const statement = established
      ? judgments[i].statement?.text
      : canDescribe
      ? composeRecordedStatement(
          reads.flatMap((call) =>
            call.row === undefined
              ? []
              : [{ call, row: call.row, tool: record.tools[call.toolName] }],
          ),
          record.clock,
        ).text
      : "I don't know. The recorded searches do not establish this claim in the caller's trusted context.";
    checks.push(row);
    correction ||= row.code === 'citation-unresolved' || row.code === 'stale-turn';
    claims.push({
      kind: row.kind,
      ...(validAbout ? { about: about as string | number } : {}),
      restsOn: canDescribe || established ? reads.map((call) => call.row!.handle) : [],
      statement: statement ?? "I don't know. No admitted search supports this claim.",
      delivery: 'record-composed',
      version: STATEMENT_VERSION,
    });
  }
  const established = checks.every((row) => row.code === 'established');
  const allowed = established || config.unestablished === 'state-searched';
  const examined = new Set(checks.flatMap((row) => row.results));
  const coverage = config.tools.map((tool) => ({
    tool,
    checked: record.calls.filter(
      (call) =>
        examined.has(call.resultId) &&
        call.toolName === tool &&
        call.turn === record.turn &&
        returnedReading(call) &&
        call.row?.composed === 'local' &&
        call.keptOut !== true &&
        trusted(call),
    ).length,
  }));
  const answer: AnswerNegatives = {
    field: config.field,
    version: STATEMENT_VERSION,
    delivery: allowed ? (established && checks.length > 0 ? 'as-checked' : 'recorded') : 'fallback',
    claims,
    checks,
    coverage,
    actions: record.calls
      .filter((call) => call.turn === record.turn && call.dispatched && call.effect !== 'read')
      .map((call) => ({ tool: call.toolName, outcome: call.outcome })),
  };
  return { candidate: { ...source, [config.field]: claims }, answer, correction, allowed };
}

/** Merge negative verdicts without manufacturing a successful host comparison. */
export function reportWithNegatives(
  report: AnswerValidationReport,
  answer: AnswerNegatives,
  allowed: boolean,
): AnswerValidationReport {
  const rows: AnswerCheck[] = answer.checks.map((row) => ({
    id: row.id,
    path: row.path,
    disposition: row.disposition,
    reason: row.code,
  }));
  const checks = [...report.checks, ...rows];
  const failed = checks.filter((row) => row.disposition === 'checked-fail').length;
  const unreachable = checks.filter((row) => row.disposition === 'unreachable').length;
  return {
    ...report,
    checks,
    failed,
    unreachable,
    checked: checks.filter(
      (row) => row.disposition === 'checked-pass' || row.disposition === 'checked-fail',
    ).length,
    notApplicable: checks.filter((row) => row.disposition === 'not-applicable').length,
    status: failed > 0 ? 'failed' : unreachable > 0 ? 'unverified' : report.status,
    delivery: allowed ? answer.delivery : 'fallback',
  };
}
