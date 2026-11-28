/**
 * llm-ledger/calls — one short FootprintJS run per call.
 *
 * Pattern: the chart is built per call (`chartOf`), so stage closures hold the call's input and the
 *          attempt's reader (`stages.ts` · `CallFrame`); a fresh `FlowChartExecutor` runs it with
 *          the input `{ call }` and nothing else. The reply is built in the frame by `serve.ts`,
 *          never in scope.
 * Role:    the frame every call shares — `read-call` → `load-log` → `admit` → the call's own stages
 *          → `append` → `after-append` → `reply` — and the one pause, `await-person`.
 * Emits:   N/A.
 *
 * `read-call` validates the input against its caps with PR 1's builders and keeps the built entry
 * (tokens read and digests taken once, before any load); `extract-tokens` and the stamping stages
 * give it its real seq. The only pause is `await-person`, for a session opened with `confirm: true`:
 * the host's `confirm` port answers and the run resumes in this process. The checkpoint is never
 * stored or sent. Without a port, the run resumes with `withhold` and `why: 'no-person-channel'`.
 */
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { RedactionPolicy, TypedScope } from 'footprintjs';

import {
  deliveredEntry,
  noteEntry,
  openedEntry,
  receiptEntry,
  submitEntry,
  suppliedEntry,
  withdrawalEntry,
} from './build.js';
import type { LedgerBuilt, LedgerRecordInput } from './build.js';
import { isObject } from './entries.js';
import { LEDGER_LIMITS as L } from './limits.js';
import type { LedgerReader } from './reader.js';
import type { LedgerReport, LedgerStanding } from './report.js';
import { compare, stampDelivered } from './delivery.js';
import type { LedgerRule } from './rules/port.js';
import { withValueLaw } from './rules/traceableValues.js';
import { serveCoverageOmissions, serveReceipts, serveReport } from './serve.js';
import type { LedgerServed } from './serve.js';
import { isSessionId } from './session.js';
import {
  ADMIT_WORDS,
  admit,
  afterAppend,
  append,
  appendReleased,
  awaitPerson,
  checkClaims,
  checkDraft,
  fold,
  loadLog,
  refuse,
  refuseAppend,
  release,
  stampBuilt,
} from './stages.js';
import type { CallFrame, CallState, LedgerCallKind } from './stages.js';
import type { LedgerStore } from './store.js';
import type { LedgerDelivered, LedgerEntry } from './types.js';

/** What the person is asked: no values, only the submit, its standing and its counts. */
export interface LedgerConfirmAsk {
  readonly submit: number;
  readonly standing: LedgerStanding;
  readonly counts: Readonly<Record<string, number>>;
}

/** The host's person channel. */
export type LedgerConfirm = (ask: LedgerConfirmAsk) => Promise<'release' | 'withhold'>;

/** What every call runs with. */
export interface LedgerCallContext {
  readonly store: LedgerStore;
  readonly rules: ReadonlyMap<string, LedgerRule>;
  readonly builtInKeys: readonly string[];
  readonly redaction?: RedactionPolicy;
  readonly confirm?: LedgerConfirm;
  readonly clock: () => string;
  /** Each run's snapshot, for audits and tests. */
  readonly runs?: (record: { readonly call: LedgerCallKind; readonly snapshot: unknown }) => void;
}

type Scope = TypedScope<CallState>;

/** A provisional stamp: validation before the log is loaded; the real seq comes later. */
const PROVISIONAL = (at: string) => ({ seq: L.maxEntries, at });

/** `read-call`: the input against its caps, built once. A refusal goes to `admit` as a fact. */
function readCall(frame: CallFrame) {
  return async (s: Scope): Promise<void> => {
    s.inputRefusal = '';
    if (frame.kind !== 'open' && !isSessionId(frame.session)) {
      s.inputRefusal = 'bad-session';
      return;
    }
    if (!isObject(frame.input)) {
      s.inputRefusal = 'bad-input';
      return;
    }
    const stamp = PROVISIONAL(frame.clock());
    const i = frame.input as never;
    let built: LedgerBuilt<LedgerEntry> | undefined;
    switch (frame.kind) {
      case 'open':
        built = openedEntry(stamp, i);
        break;
      case 'record':
        built = receiptEntry(stamp, i as LedgerRecordInput);
        break;
      case 'supply':
        built = await suppliedEntry(stamp, i);
        break;
      case 'deliver': {
        const delivery = await deliveredEntry(stamp, i, undefined);
        built = delivery;
        if (delivery.coverage !== undefined) frame.deliveryCoverage = delivery.coverage;
        break;
      }
      case 'note':
        built = noteEntry(stamp, i);
        break;
      case 'withdraw':
        built = withdrawalEntry(stamp, i);
        break;
      case 'submit':
        built = await submitEntry(stamp, i);
        break;
      default:
        if (Object.keys(frame.input).length > 0) s.inputRefusal = 'bad-input';
        return;
    }
    if (!built.ok) s.inputRefusal = built.refused;
    else frame.built = built.entry;
  };
}

/** The reply of an appended call, from the frame. Words, numbers and digests; a report through `serve.ts`. */
function reply(frame: CallFrame, ctx: LedgerCallContext) {
  return (s: Scope) => {
    const o = { redact: ctx.redaction !== undefined };
    const first = s.appendedSeq - ((frame.batchAt?.(0).length ?? 1) - 1);
    const built = frame.built;
    switch (frame.kind) {
      case 'open':
        frame.reply = {
          ok: true,
          session: frame.session,
          seq: 1,
          rules: [...(built as LedgerEntry & { kind: 'opened' }).rules],
        };
        return;
      case 'record': {
        const r = built as LedgerEntry & { kind: 'receipt' };
        frame.reply = {
          ok: true,
          receipt: s.appendedSeq,
          tokens: r.tokens.length,
          ...(r.cut === undefined ? {} : { cut: { ...r.cut } }),
        };
        return;
      }
      case 'supply':
        frame.reply = {
          ok: true,
          supplied: s.appendedSeq,
          tokens: (built as LedgerEntry & { kind: 'supplied' }).tokens.length,
        };
        return;
      case 'deliver':
        frame.reply = {
          ok: true,
          submit: frame.reader?.lastSubmit?.seq ?? null,
          matches: s.matches === true,
          ...serveCoverageOmissions(
            (frame.after?.at(-1) as LedgerDelivered | undefined)?.coverageOmissions,
          ),
        };
        return;
      case 'note':
        frame.reply = { ok: true, note: s.appendedSeq };
        return;
      case 'withdraw':
        frame.reply = { ok: true, withdrawal: s.appendedSeq };
        return;
      case 'report':
        frame.reply = { ok: true, report: serveReport(frame.report as LedgerReport, o) };
        return;
      case 'ask':
        frame.reply = {
          ok: true,
          report: serveReport(frame.report as LedgerReport, o),
          receipts: serveReceipts(frame.reader as LedgerReader),
        };
        return;
      case 'submit': {
        const submit = (built as LedgerEntry & { kind: 'submit' }).draftDigest;
        frame.reply =
          s.answer === 'withhold'
            ? { ok: true, submit: first, withheld: true }
            : {
                ok: true,
                submit: first,
                draftDigest: submit,
                report: serveReport(frame.report as LedgerReport, {
                  ...o,
                  draft: frame.input.draft as string,
                }),
              };
        return;
      }
    }
  };
}

const noop = () => undefined;

/** The chart of one call. */
function chartOf(frame: CallFrame, ctx: LedgerCallContext) {
  let b = flowChart<CallState>('read-call', readCall(frame), 'read-call')
    .addFunction('load-log', loadLog(frame), 'load-log')
    .addDeciderFunction('admit', admit(frame), 'admit');
  for (const word of ADMIT_WORDS)
    b = b.addFunctionBranch(word, `refuse: ${word}`, refuse(frame, word));
  let chain = b.addFunctionBranch('go', 'go', noop).setDefault('go').end();
  const k = frame.kind;
  if (k === 'record' || k === 'supply')
    chain = chain.addFunction('extract-tokens', stampBuilt(frame), 'extract-tokens');
  if (k === 'open' || k === 'note' || k === 'withdraw')
    chain = chain.addFunction('stamp', stampBuilt(frame), 'stamp');
  if (k === 'deliver')
    chain = chain
      .addDeciderFunction('compare', compare(frame), 'compare')
      .addFunctionBranch('matches', 'matches', noop)
      .addFunctionBranch('differs', 'differs', noop)
      .addFunctionBranch('no-submit', 'no-submit', noop)
      .setDefault('differs')
      .end()
      .addFunction('stamp-delivered', stampDelivered(frame), 'stamp-delivered');
  if (k === 'submit')
    chain = chain
      .addFunction('check-claims', checkClaims(frame), 'check-claims')
      .addFunction('check-draft', checkDraft(frame), 'check-draft');
  if (k === 'ask')
    // A dry run under `askRunsRules`: the same checks, nothing appended (`preview: true`).
    chain = chain.addFunction(
      'check-claims',
      async (s: Scope) => (s.askRunsRules ? checkClaims(frame)(s) : undefined),
      'check-claims',
    );
  if (k === 'submit' || k === 'ask' || k === 'report')
    chain = chain.addFunction('fold', fold(frame), 'fold');
  if (k !== 'ask' && k !== 'report')
    chain = chain
      .addFunction('append', append(frame), 'append')
      .addDeciderFunction('after-append', afterAppend(), 'after-append')
      .addFunctionBranch('appended', 'appended', noop)
      .addFunctionBranch('append-refused', 'append refused', refuseAppend(frame))
      .addFunctionBranch('busy', 'busy', refuse(frame, 'busy'))
      .addFunctionBranch('conflict', 'conflict', noop, undefined, { loopTo: 'load-log' })
      .setDefault('conflict')
      .end();
  if (k === 'submit')
    chain = chain
      .addDeciderFunction('release', release(), 'release')
      .addPausableFunctionBranch('await-person', 'await-person', awaitPerson(frame))
      .addFunctionBranch('no-wait', 'no-wait', noop)
      .setDefault('no-wait')
      .end()
      .addFunction('append-released', appendReleased(frame), 'append-released');
  return chain.addFunction('reply', reply(frame, ctx), 'reply').build();
}

const isPaused = (r: unknown): r is { paused: true; checkpoint: { pauseData?: unknown } } =>
  typeof r === 'object' && r !== null && (r as { paused?: unknown }).paused === true;

/** Runs one call, start to reply. Never throws on a refusal: the reply says it. */
export async function runCall(
  ctx: LedgerCallContext,
  kind: LedgerCallKind,
  session: string,
  input: unknown,
): Promise<LedgerServed> {
  const frame: CallFrame = {
    kind,
    session,
    store: ctx.store,
    rules: ctx.rules,
    clock: ctx.clock,
    input: (input ?? {}) as Record<string, unknown>,
    loads: 0,
  };
  // A session opened without `rules` runs the built-ins; one opened with any set also runs the value law.
  if (
    kind === 'open' &&
    isObject(input) &&
    (input.rules === undefined || Array.isArray(input.rules))
  )
    (frame as { input: Record<string, unknown> }).input = {
      ...input,
      rules: withValueLaw(input.rules === undefined ? ctx.builtInKeys : (input.rules as string[])),
    };
  const executor = new FlowChartExecutor(chartOf(frame, ctx));
  if (ctx.redaction !== undefined) executor.setRedactionPolicy(ctx.redaction);
  let result: unknown = await executor.run({ input: { call: kind } });
  if (isPaused(result)) {
    const ask = result.checkpoint.pauseData as LedgerConfirmAsk;
    let answer: 'release' | 'withhold' = 'withhold';
    let why: string | undefined = 'no-person-channel';
    if (ctx.confirm !== undefined) {
      try {
        answer = (await ctx.confirm(ask)) === 'release' ? 'release' : 'withhold';
        why = undefined;
      } catch {
        // A person channel that fails is no person channel: withhold, and say so.
      }
    }
    result = await executor.resume(result.checkpoint as never, { answer, why });
  }
  ctx.runs?.({ call: kind, snapshot: executor.getSnapshot() });
  return frame.reply ?? { ok: false, refused: 'busy' };
}
