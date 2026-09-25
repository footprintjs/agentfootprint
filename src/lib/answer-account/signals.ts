/**
 * The three checks, their signals, what could not be run, the "Anything wrong"
 * row and the one-liner.
 *
 * Signals, not causes: each signal is a record fact under a fixed rule; the
 * account never assigns fault. PRIORITY (the order signals are listed and the
 * one-liner quotes them):
 *   1. decided-delivered — `decided-not-delivered` (bad)
 *   2. existence         — `existence-not-checked`, from a `notChecked` OR a
 *                          `cannotCover` item with `kind: 'existence'` (warn)
 *   3. empty-results     — `undeclared-empty-used` (bad), then
 *                          `undeclared-empty-in-view` (warn)
 * The disposition law: a check that could not run is NOT "nothing wrong" — it
 * is listed as unreachable, and a check that does not apply to this answer is
 * left out of the count (`reachable + unreachable + notApplicable = 3`).
 */

import { chip, dedupePointers, joinSentences, n, v } from './render.js';
import type {
  CheckId,
  RecordPointer,
  Sentence,
  SentenceVar,
  Signal,
  Unreachable,
} from './types.js';
import { at, emptinessSource, type ReadContext } from './facts/common.js';
import { itemAt, type CallsRead } from './facts/calls.js';
import { inViewPointers, inViewVars } from './facts/found.js';
import type { InViewAll } from './facts/inView.js';
import type { UnderstoodRead } from './facts/understood.js';

/** Signal lines per check, and unreachable lines per check, before the rest are counted. */
export const MAX_LINES_PER_CHECK = 3;

export interface ChecksRead {
  readonly signals: readonly Signal[];
  /** Signal and unreachable lines past `MAX_LINES_PER_CHECK`, counted, not listed. */
  readonly omitted: number;
  readonly omittedPointers: readonly RecordPointer[];
  readonly unreachable: readonly Unreachable[];
  readonly reachable: readonly CheckId[];
  readonly unreachableChecks: readonly CheckId[];
  readonly notApplicable: readonly CheckId[];
  /** Pointers behind the checks that ran (for "found nothing"). */
  readonly checkPointers: readonly RecordPointer[];
}

type State = 'reachable' | 'unreachable' | 'not-applicable';

export function runChecks(
  ctx: ReadContext,
  understood: UnderstoodRead,
  calls: CallsRead,
  inView: InViewAll,
): ChecksRead {
  const signals: Signal[] = [];
  const unreachable: Unreachable[] = [];
  let omitted = 0;
  const omittedPointers: RecordPointer[] = [];
  const omit = (sentence: Sentence) => {
    omitted += 1;
    if (omittedPointers.length < MAX_LINES_PER_CHECK)
      omittedPointers.push(...sentence.pointers.slice(0, 1));
  };
  const perCheck = (list: readonly { readonly check: CheckId }[], check: CheckId) =>
    list.filter((x) => x.check === check).length;
  const addSignal = (signal: Signal) => {
    if (perCheck(signals, signal.check) >= MAX_LINES_PER_CHECK) omit(signal.sentence);
    else signals.push(signal);
  };
  const addUnreachable = (u: Unreachable) => {
    if (perCheck(unreachable, u.check) >= MAX_LINES_PER_CHECK) omit(u.sentence);
    else unreachable.push(u);
  };
  const states: Record<CheckId, State> = {
    'decided-delivered': understood.check,
    existence: 'not-applicable',
    'empty-results': 'not-applicable',
  };
  const checkPointers: RecordPointer[] = [];

  // 1 — decided-delivered (read by the understood row, which owns the proof).
  if (understood.signal !== undefined) {
    addSignal({
      id: 'decided-not-delivered',
      check: 'decided-delivered',
      sentence: understood.signal,
      tone: 'bad',
    });
  }
  if (understood.unreachable !== undefined) {
    addUnreachable({
      check: 'decided-delivered',
      missing: understood.unreachable.missing ?? 'no-event',
      sentence: understood.unreachable,
    });
  }
  if (understood.check === 'reachable') checkPointers.push(...understood.checkPointers);

  // A call no event names cannot be put in a sentence about its tool: every check it would
  // feed is said to be unreachable for it, by its call id — never silently skipped.
  const unnamed = (check: CheckId, call: (typeof calls.all)[number]) => {
    states[check] = 'unreachable';
    addUnreachable({
      check,
      missing: 'unreadable',
      sentence: ctx.say('unreachable.unnamed', {
        vars: { id: call.tool },
        status: 'not-recorded',
        missing: 'unreadable',
        pointers: call.fact.pointers,
      }),
    });
  };

  // 2 — existence: EVERY call of this run (the listing cap never limits a check) whose
  // declaration has not-checked / cannot-cover items — every item, not only the printed ones.
  for (const call of calls.all) {
    const items = call.coverage?.items.filter((i) => i.section !== 'checked') ?? [];
    if (items.length === 0) continue;
    if (call.unnamed) {
      unnamed('existence', call);
      continue;
    }
    const tool = call.tool;
    const withKind = items.filter((i) => i.kind !== undefined);
    if (withKind.length === 0) {
      states.existence = 'unreachable';
      addUnreachable({
        check: 'existence',
        missing: 'not-declared',
        sentence: ctx.say('unreachable.existence', {
          vars: { tool },
          status: 'not-recorded',
          missing: 'not-declared',
          pointers: items.slice(0, 1).map((i) => itemAt(i, 'what')),
        }),
      });
      continue;
    }
    if (states.existence === 'not-applicable') states.existence = 'reachable';
    checkPointers.push(...withKind.map((i) => itemAt(i, 'kind')));
    for (const item of withKind.filter((i) => i.kind === 'existence')) {
      const source = `tool:${call.fact.toolName}` as const;
      const never = item.section === 'cannotCover';
      const sentence =
        item.short !== undefined
          ? ctx.say(never ? 'signal.existenceCannotCover' : 'signal.existenceNotChecked', {
              vars: { tool, short: v(item.short, source, itemAt(item, 'short')) },
              pointers: [itemAt(item, 'kind')],
            })
          : ctx.say(
              never ? 'signal.existenceCannotCover.full' : 'signal.existenceNotChecked.full',
              {
                vars: { tool, what: v(item.what, source, itemAt(item, 'what')) },
                pointers: [itemAt(item, 'kind')],
              },
            );
      addSignal({ id: 'existence-not-checked', check: 'existence', sentence, tone: 'warn' });
    }
  }

  // 3 — empty results: this run's results (judged ones) and the earlier ones in view.
  // Used before in-view: this run's results are read first, so their signals land first.
  const judged = calls.all.filter(
    (c) => c.fact.outcome === 'ran' && c.fact.withheldBy === undefined && c.end !== undefined,
  );
  if (judged.length > 0 || inView.all.length > 0) states['empty-results'] = 'reachable';
  const shapeUnknown = (tool: SentenceVar, pointer: RecordPointer) => {
    states['empty-results'] = 'unreachable';
    addUnreachable({
      check: 'empty-results',
      missing: 'not-declared',
      sentence: ctx.say('unreachable.empty', {
        vars: { tool },
        status: 'not-recorded',
        missing: 'not-declared',
        pointers: [pointer],
      }),
    });
  };
  for (const call of judged) {
    const end = call.end;
    if (end === undefined) continue; // `judged` keeps only calls with an end
    if (call.unnamed) {
      unnamed('empty-results', call);
      continue;
    }
    if (call.emptiness.undeclaredShape) {
      shapeUnknown(call.tool, at(end, 'toolCallId'));
      continue;
    }
    checkPointers.push(...call.fact.pointers.slice(-1));
    if (call.emptiness.emptiness !== 'undeclared-empty') continue;
    addSignal({
      id: 'undeclared-empty-used',
      check: 'empty-results',
      tone: 'bad',
      sentence: ctx.say('signal.undeclaredEmptyUsed', {
        vars: { tool: call.tool },
        basis: [emptinessSource(call.emptiness)],
        pointers: call.fact.pointers,
      }),
    });
  }
  for (const read of inView.all) {
    if (read.reading.undeclaredShape) {
      shapeUnknown(read.tool, at(read.witness, 'sourceId'));
      continue;
    }
    checkPointers.push(at(read.witness, 'sourceId'));
    if (read.reading.emptiness !== 'undeclared-empty') continue;
    addSignal({
      id: 'undeclared-empty-in-view',
      check: 'empty-results',
      tone: 'warn',
      sentence: ctx.say('signal.undeclaredEmptyInView', {
        vars: inViewVars(read),
        basis: [emptinessSource(read.reading)],
        pointers: inViewPointers(ctx, read),
      }),
    });
  }

  const ids: readonly CheckId[] = ['decided-delivered', 'existence', 'empty-results'];
  return {
    signals,
    // Pointers stand for the checks that ran — a sample is enough, and the account stays bounded.
    omitted,
    omittedPointers,
    unreachable,
    reachable: ids.filter((id) => states[id] === 'reachable'),
    unreachableChecks: ids.filter((id) => states[id] === 'unreachable'),
    notApplicable: ids.filter((id) => states[id] === 'not-applicable'),
    checkPointers: dedupePointers(checkPointers).slice(0, MAX_LINES_PER_CHECK * 2),
  };
}

/** The "Anything wrong" row's lines, in order. */
export function wrongLines(ctx: ReadContext, checks: ChecksRead, calls: CallsRead): Sentence[] {
  const lines: Sentence[] = checks.signals.map((s) => s.sentence);
  // Every call, not only the listed ones: a count is a judgement.
  const all = calls.all;
  const count = (o: string) => all.filter((c) => c.fact.outcome === o).length;
  const failed = count('failed');
  const refused = count('refused');
  const declined = count('declined');
  const notDispatched = count('not-dispatched');
  const troubled = all.filter((c) =>
    ['failed', 'refused', 'declined', 'not-dispatched'].includes(c.fact.outcome),
  );
  if (troubled.length > 0) {
    lines.push(
      ctx.say('wrong.errors', {
        vars: {
          n: n(troubled.length),
          failed: n(failed),
          refused: n(refused),
          declined: n(declined),
          notDispatched: n(notDispatched),
        },
        pointers: troubled.flatMap((c) => c.fact.pointers.slice(-1)),
      }),
    );
  } else if (all.length > 0) {
    lines.push(
      ctx.say('wrong.noErrors', { pointers: all.flatMap((c) => c.fact.pointers.slice(-1)) }),
    );
  }
  const withheld = all.filter((c) => c.fact.withheldBy !== undefined && c.ruleEvent !== undefined);
  if (withheld.length > 0) {
    lines.push(
      ctx.say('wrong.withheld', {
        vars: { n: n(withheld.length) },
        pointers: withheld.flatMap((c) => (c.ruleEvent ? [at(c.ruleEvent, 'outcome')] : [])),
      }),
    );
  }
  const applicable = checks.reachable.length + checks.unreachableChecks.length;
  if (checks.signals.length === 0 && checks.reachable.length > 0) {
    lines.push(
      ctx.say('wrong.none', {
        vars: { reachable: n(checks.reachable.length) },
        pointers: checks.checkPointers,
        chips: [chip('none-found', 'chip.noneFound', 'ok')],
      }),
    );
  }
  if (checks.unreachableChecks.length > 0) {
    lines.push(
      checks.unreachableChecks.length === applicable
        ? ctx.say('wrong.unreachable.all', {
            status: 'not-recorded',
            missing: 'not-declared',
            chips: [chip('not-recorded', 'chip.notRecorded')],
          })
        : ctx.say('wrong.unreachable', {
            vars: { unreachable: n(checks.unreachableChecks.length), applicable: n(applicable) },
            status: 'not-recorded',
            missing: 'not-declared',
            chips: [chip('not-recorded', 'chip.notRecorded')],
          }),
      ...checks.unreachable.map((u) => ({ ...u.sentence, item: true as const })),
    );
  }
  if (checks.omitted > 0) {
    lines.push(
      ctx.say('wrong.more', { vars: { n: n(checks.omitted) }, pointers: checks.omittedPointers }),
    );
  }
  if (applicable === 0 && checks.signals.length === 0) {
    lines.push(ctx.say('wrong.notApplicable', { status: 'not-applicable' }));
  }
  if (ctx.resumedLeg) {
    lines.push(
      ctx.say('wrong.beforePause', {
        status: 'not-recorded',
        missing: 'before-pause',
        chips: [chip('before-pause', 'chip.beforePause')],
      }),
    );
  }
  if (ctx.view.scope === 'unfiltered') {
    lines.push(ctx.say('scope.unfiltered', { status: 'not-recorded', missing: 'no-event' }));
  }
  return lines;
}

export interface SummaryRead {
  readonly sentence: Sentence;
  readonly tone: 'ok' | 'warn' | 'bad' | 'unknown';
}

/** The one-liner. */
export function summaryOf(ctx: ReadContext, checks: ChecksRead, finished: boolean): SummaryRead {
  if (!finished) {
    return {
      sentence: ctx.say('summary.unfinished', { status: 'not-recorded', missing: 'no-event' }),
      tone: 'unknown',
    };
  }
  const [first, second] = checks.signals;
  if (first !== undefined) {
    let sentence = joinSentences(first.sentence, second?.sentence);
    if (ctx.resumedLeg) {
      sentence = joinSentences(
        sentence,
        ctx.say('summary.resumed.tail', { status: 'not-recorded', missing: 'before-pause' }),
      );
    }
    return { sentence, tone: first.tone };
  }
  if (ctx.resumedLeg) {
    return {
      sentence: ctx.say('summary.resumed', { status: 'not-recorded', missing: 'before-pause' }),
      tone: 'unknown',
    };
  }
  const applicable = checks.reachable.length + checks.unreachableChecks.length;
  if (checks.unreachableChecks.length > 0) {
    return checks.unreachableChecks.length === applicable
      ? {
          sentence: ctx.say('summary.none.nothingRun', {
            status: 'not-recorded',
            missing: 'not-declared',
          }),
          tone: 'unknown',
        }
      : {
          sentence: ctx.say('summary.none.partial', {
            vars: { unreachable: n(checks.unreachableChecks.length), applicable: n(applicable) },
            status: 'not-recorded',
            missing: 'not-declared',
          }),
          tone: 'unknown',
        };
  }
  if (applicable === 0) {
    return {
      sentence: ctx.say('summary.none.notApplicable', { status: 'not-applicable' }),
      tone: 'unknown',
    };
  }
  return { sentence: ctx.say('summary.none', { pointers: checks.checkPointers }), tone: 'ok' };
}
