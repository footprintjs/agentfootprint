/**
 * llm-ledger/serve — the one funnel everything served passes through.
 *
 * Pattern: projections from the fold (`report.ts`) and the reader to plain JSON. Nothing else in
 *          the folder builds a reply that carries a log's content.
 * Role:    what an agent, the command line or a later view is shown. A receipt's tokens, a
 *          receipt's query and a supplied entry's content are never served: no projection here
 *          reads them.
 * Emits:   N/A.
 *
 * Without a redaction policy, the agent's own note text and the missing tokens are quoted. With
 * one (`redact: true`, set when the host gives `createLedger` a `redaction` policy), every string
 * is served as `{ masked: '[REDACTED]', span }` unless it is a ledger word, a rule id, a digest, an
 * instant or a host name (a receipt's `source` or `externalId`); `span` is the string's character
 * range in the caller's own text — the note, or the draft when the call has it — so the agent can
 * still find it. Numbers and booleans pass.
 */
import { chars, isIncomplete } from './entries.js';
import { LEDGER_LIMITS as L } from './limits.js';
import type { LedgerReader } from './reader.js';
import { REPORT_SENTENCES } from './report.js';
import type { LedgerCheckView, LedgerReport, LedgerSubjectReport } from './report.js';
import type { LedgerRefusal } from './types.js';

/** What every served value is: JSON. */
export type LedgerServed =
  | string
  | number
  | boolean
  | null
  | readonly LedgerServed[]
  | { readonly [key: string]: LedgerServed };

/** How to serve: masked or quoted, and the text spans are counted in. */
export interface LedgerServeOptions {
  readonly redact: boolean;
  /** The draft of the call being answered, when it has one: spans of its missing tokens. */
  readonly draft?: string;
}

/** The placeholder a masked string is served as. */
export const SERVED_PLACEHOLDER = '[REDACTED]';

/** A string the agent or the draft wrote: quoted, or masked with its span in `within`. */
function own(value: string, within: string | undefined, o: LedgerServeOptions): LedgerServed {
  if (!o.redact) return value;
  if (within === undefined) return { masked: SERVED_PLACEHOLDER };
  const at = within.toLowerCase().indexOf(value.toLowerCase());
  if (at === -1) return { masked: SERVED_PLACEHOLDER };
  const start = chars(within.slice(0, at));
  return { masked: SERVED_PLACEHOLDER, span: [start, start + chars(value)] };
}

function check(
  c: LedgerCheckView,
  within: string | undefined,
  o: LedgerServeOptions,
): LedgerServed {
  return {
    rule: c.rule,
    disposition: c.disposition,
    ...(c.verdict === undefined ? {} : { verdict: c.verdict }),
    restsOn: [...c.restsOn],
    counts: { ...c.counts },
    ...(c.missing === undefined ? {} : { missing: c.missing.map((t) => own(t, within, o)) }),
    ...(c.why === undefined ? {} : { why: c.why }),
  };
}

function subject(s: LedgerSubjectReport, within: string | undefined, o: LedgerServeOptions) {
  return {
    ...(s.verdict === undefined ? {} : { verdict: s.verdict }),
    ...(s.reason === undefined ? {} : { reason: s.reason }),
    restsOn: s.restsOn,
    missing: s.missing.map((t) => own(t, within, o)),
    checks: s.checks.map((c) => check(c, within, o)),
  };
}

/** The served report. */
export function serveReport(report: LedgerReport, o: LedgerServeOptions): LedgerServed {
  return {
    standing: report.standing,
    reasons: [...report.reasons],
    submit: report.submit,
    ...(report.draftDigest === undefined ? {} : { draftDigest: report.draftDigest }),
    ...(report.preview ? { preview: true } : {}),
    claims: report.claims.map((c) => ({
      note: c.note,
      kind: c.kind,
      text: own(c.text, c.text, o),
      ...subject(c, c.text, o),
    })),
    ...(report.draft === undefined ? {} : { draft: subject(report.draft, o.draft, o) }),
    counts: { ...report.counts },
    receipts: {
      observed: report.receipts.observed,
      reported: report.receipts.reported,
      incomplete: [...report.receipts.incomplete],
    },
    withdrawnAfterCheck: report.withdrawnAfterCheck.map((w) => ({ ...w })),
    notChecked: [...report.notChecked],
    openQuestions: [...report.openQuestions],
    delivery: report.delivery,
    release: report.release,
    full: report.full,
    sentences: [...REPORT_SENTENCES],
  };
}

/** The newest receipts `ask` lists: facts about each read, never its tokens or query. */
export function serveReceipts(reader: LedgerReader): LedgerServed {
  return reader.receipts
    .slice(-L.askReceipts)
    .reverse()
    .map((r) => ({
      receipt: r.seq,
      source: r.source,
      how: r.how,
      at: r.at,
      ...(r.window === undefined ? {} : { window: { from: r.window.from, to: r.window.to } }),
      nothingFound: r.nothingFound,
      incomplete: isIncomplete(r),
      ...(r.externalId === undefined ? {} : { externalId: r.externalId }),
    }));
}

/** A refusal: its word, and a store's code with `store-refused`. Never a value. */
export function serveRefusal(word: LedgerRefusal, store?: string): LedgerServed {
  return { ok: false, refused: word, ...(store === undefined ? {} : { store }) };
}
