/** Runtime admission and delivery for typed negative citations. The pure checker
 * compares reads; this boundary additionally binds every citation to this app's
 * admitted dispatches and trusted caller context. Model text is never evidence. */
import { MAX_NEGATIVE_CLAIMS } from '../../../integrity/negative-claim/limits.js';
import { judgeTypedNegatives } from '../../../integrity/negative-claim/judge.js';
import { sameValue, scopeOf, returnedReading } from '../../../integrity/negative-claim/readings.js';
import {
  composeRecordedStatement,
  quoteValue,
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
import type { DeliveredNegative } from '../../../events/payloads.js';
export type { DeliveredNegative } from '../../../events/payloads.js';
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

/** Fixed explanations never borrow scope or instructions from the model's citation. */
const REFUSALS: Readonly<Record<Exclude<RuntimeNegativeCode, 'established'>, string>> = {
  'contradicted-by-rows': "I don't know that this claim holds: recorded rows contradict it.",
  'wider-search-has-rows':
    "I don't know. A wider search returned rows that may be within this claim's scope.",
  'other-read-has-rows':
    "I don't know. Another read for this subject returned rows that have not been shown to lie outside this claim's scope.",
  'search-incomplete':
    "I don't know. The cited result does not cover the complete search required by this claim.",
  'superseded-by-write':
    "I don't know. After or in the same batch as this read, a call that may change the data was dispatched; the earlier result no longer establishes this claim.",
  'later-read-failed':
    "I don't know. A later attempt to repeat this search failed; the earlier result does not settle the current claim.",
  'citation-unresolved':
    "I don't know. The citation does not identify an admitted recorded search.",
  'cited-call-undeclared':
    "I don't know. The cited call is not declared as an eligible source for this claim.",
  'coverage-unverified':
    "I don't know. The cited coverage was not composed by this runtime from a trusted local search declaration.",
  'call-not-read':
    "I don't know. The cited call did not establish a read that can support this claim.",
  'kind-mismatch':
    "I don't know. This kind of negative claim does not match what the cited search established.",
  'about-mismatch':
    "I don't know. The model's cited subject does not match the population the admitted search actually covered.",
  'record-incomplete':
    "I don't know. The available execution record is incomplete, so it cannot establish this claim.",
  'stale-turn':
    "I don't know. The cited result belongs to an earlier turn and was not re-read during this turn.",
  'too-many-claims':
    "I don't know. The claim or reference count exceeds the checking limit; no checked prefix is accepted.",
  'outside-trusted-context':
    "I don't know. The cited search is not bound to the caller's trusted context.",
};

function refusalFor(row: RuntimeNegativeRow): string {
  if (row.code === 'established') return '';
  // Retained stale identities carry runtime-produced turn/date metadata even
  // when their scope was scrubbed. This says when the read ran, not what it read.
  if (row.code !== 'stale-turn' || row.staleSince === undefined) return REFUSALS[row.code];
  const readAt = row.staleSince.readAt;
  const date = readAt === undefined ? NaN : Date.parse(readAt);
  return (
    `I don't know. The cited result was read on turn ${row.staleSince.turn}` +
    (Number.isFinite(date) ? ` at ${new Date(date).toISOString()}` : '') +
    '; not re-read during the current turn.'
  );
}

const positivePeer = (other: TurnCall, cited: TurnCall, about: unknown): boolean =>
  other.resultId !== cited.resultId &&
  returnedReading(other) &&
  other.emptiness === 'non-empty' &&
  subject(cited) !== undefined &&
  sameValue(subject(other), subject(cited)) &&
  aboutFits(about, other) &&
  !rowsOutside(other, cited);

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
            other.turn === record.turn && reads.some((cited) => positivePeer(other, cited, about)),
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
          call.turn <= record.turn &&
          config.tools.includes(call.toolName) &&
          call.row?.composed === 'local' &&
          call.keptOut !== true,
      );
    const established = row.code === 'established';
    const contrary =
      !established && canDescribe
        ? record.calls.filter(
            (other) =>
              other.turn === record.turn &&
              trusted(other) &&
              other.row?.composed === 'local' &&
              other.keptOut !== true &&
              config.tools.includes(other.toolName) &&
              !reads.some((read) => read.resultId === other.resultId) &&
              reads.some((cited) => positivePeer(other, cited, about)),
          )
        : [];
    if (contrary.length > 0)
      row = {
        ...row,
        results: [...new Set([...row.results, ...contrary.map((call) => call.resultId)])],
      };
    const refusal = refusalFor(row);
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
          {
            refusal,
            contraryReads: contrary.flatMap((call) =>
              call.row === undefined
                ? []
                : [{ call, row: call.row, tool: record.tools[call.toolName] }],
            ),
          },
        ).text
      : refusal;
    checks.push(row);
    correction ||= row.code === 'citation-unresolved' || row.code === 'stale-turn';
    claims.push({
      kind: row.kind,
      ...(validAbout ? { about: quoteValue(about) } : {}),
      restsOn:
        canDescribe || established ? [...reads, ...contrary].map((call) => call.row!.handle) : [],
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
    delivery: allowed
      ? established && checks.length > 0 && Object.keys(source).every((key) => key === config.field)
        ? 'as-checked'
        : 'recorded'
      : 'fallback',
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
