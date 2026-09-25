/**
 * Row "It found" — what each call of this run returned, as the MODEL read it,
 * then the earlier answers' results that were in front of the model.
 *
 * Branches on the call's outcome first: a call that did not run "found nothing"
 * because it did not run; a withheld result is never judged empty (the model
 * read the rule's refusal, not the rows). Emptiness is typed only — a declared
 * absence, a zero-length top-level array, or the app's declared `rowsAt` (then
 * the line is vouched `app`, because only the app's declaration makes it
 * "empty").
 */

import { chip, n, v } from '../render.js';
import type { AccountSource, RecordPointer, Sentence } from '../types.js';
import { at, declarationAt, emptinessSource, historyAt, type ReadContext } from './common.js';
import { endPointer, type CallRead, type CallsRead } from './calls.js';
import type { BeforePauseCall } from './checked.js';
import { anchorPointer, foldMore, MAX_LISTED_CALLS } from './checked.js';
import type { InViewAll, InViewRead } from './inView.js';

const toolOf = (call: CallRead) => call.tool;

/** The declaration pointer behind an app-counted emptiness. */
function rowsAtPointers(
  ctx: ReadContext,
  toolName: string,
  source?: 'library' | 'app',
): RecordPointer[] {
  return source === 'app' ? [declarationAt(ctx.declarations, `tools.${toolName}.rowsAt`)] : [];
}

function foundForCall(ctx: ReadContext, call: CallRead): Sentence {
  if (call.unnamed) {
    return ctx.say('found.unnamed', {
      vars: { id: call.tool },
      status: 'not-recorded',
      missing: 'unreadable',
      pointers: call.fact.pointers,
    });
  }
  const tool = toolOf(call);
  const end = call.end;
  const endPointers = end ? [endPointer(end, call.emptiness)] : [];
  switch (call.fact.outcome) {
    case 'failed':
      return ctx.say('found.failed', { vars: { tool }, pointers: endPointers });
    case 'refused':
      return ctx.say('found.refused', { vars: { tool }, pointers: endPointers });
    case 'declined':
      return ctx.say('found.declined', { vars: { tool }, pointers: endPointers });
    case 'not-dispatched':
      return ctx.say('found.notDispatched', { vars: { tool }, pointers: endPointers });
    case 'unknown':
      return ctx.say('found.unknown', {
        vars: { tool },
        status: 'not-recorded',
        missing: 'no-event',
        pointers: endPointers,
      });
    case 'ran':
      break;
  }
  if (call.fact.withheldBy !== undefined && call.ruleEvent !== undefined) {
    return ctx.say('found.withheld', {
      vars: { tool, by: v(call.fact.withheldBy, 'library', at(call.ruleEvent, 'middleware')) },
      pointers: [at(call.ruleEvent, 'moment'), at(call.ruleEvent, 'outcome')],
    });
  }
  const reading = call.emptiness;
  const basis: AccountSource[] = [emptinessSource(reading)];
  const extra = rowsAtPointers(ctx, call.toolName, reading.source);
  switch (reading.emptiness) {
    case 'declared-absent': {
      const lookedFor = call.coverage?.lookedFor;
      return lookedFor !== undefined
        ? ctx.say('found.absent', {
            vars: {
              tool,
              lookedFor: v(
                lookedFor.text,
                `tool:${call.fact.toolName}`,
                at(lookedFor.event, 'lookedFor'),
              ),
            },
            pointers: endPointers,
          })
        : ctx.say('found.bare', { vars: { tool }, pointers: endPointers });
    }
    case 'undeclared-empty':
      return ctx.say('found.undeclaredEmpty', {
        vars: { tool },
        basis,
        pointers: [...endPointers, ...extra],
        chips: [chip('undeclared-empty', 'chip.undeclaredEmpty', 'warn')],
      });
    case 'non-empty':
      return ctx.say('found.rows', {
        vars: { tool, n: n(reading.rows ?? 0, emptinessSource(reading)) },
        pointers: [...endPointers, ...extra],
      });
    case 'unknown':
      return ctx.say('found.result', { vars: { tool }, pointers: endPointers });
  }
}

/** The vars every in-view line shares. */
export function inViewVars(read: InViewRead) {
  return {
    tool: read.tool,
    distance: n(read.fact.distance),
    distanceWindowed: n(read.fact.windowed ? 1 : 0),
  };
}

/** Pointers behind an in-view line: the witness, the history row, the derived emptiness. */
export function inViewPointers(ctx: ReadContext, read: InViewRead): RecordPointer[] {
  return [
    at(read.witness, 'sourceId'),
    ...(read.reading.emptiness === 'unknown'
      ? []
      : [historyAt(read.historyIndex, '#emptiness', read.fact.toolCallId)]),
    ...rowsAtPointers(ctx, read.toolName, read.reading.source),
  ];
}

function inViewLine(ctx: ReadContext, read: InViewRead): Sentence {
  const vars = inViewVars(read);
  const pointers = inViewPointers(ctx, read);
  switch (read.reading.emptiness) {
    case 'undeclared-empty':
      return ctx.say('found.inView.undeclaredEmpty', {
        vars,
        basis: [emptinessSource(read.reading)],
        pointers,
        chips: [chip('undeclared-empty', 'chip.undeclaredEmpty', 'warn')],
      });
    case 'declared-absent':
      return ctx.say('found.inView.absent', { vars, pointers });
    default:
      return ctx.say('found.inView', { vars, pointers });
  }
}

export function readFoundRow(
  ctx: ReadContext,
  calls: CallsRead,
  inView: InViewAll,
  beforePause: readonly BeforePauseCall[],
): Sentence[] {
  const lines = calls.calls.slice(0, MAX_LISTED_CALLS).map((c) => foundForCall(ctx, c));
  // The same "…and N more tool calls" the other call rows carry, right after the listed calls.
  const more = foldMore(ctx, calls);
  if (more !== undefined) lines.push(more);
  if (ctx.resumedLeg && beforePause.length > 0) {
    lines.push(
      ctx.say('found.beforePause', {
        status: 'not-recorded',
        missing: 'before-pause',
        chips: [chip('before-pause', 'chip.beforePause')],
      }),
    );
  }
  if (!ctx.resumedLeg && calls.all.length === 0) {
    lines.push(ctx.say('found.noCalls', { pointers: anchorPointer(ctx) }));
  }
  lines.push(...inView.listed.map((read) => inViewLine(ctx, read)));
  if (inView.more > 0) {
    lines.push(
      ctx.say('found.inView.more', {
        vars: { n: n(inView.more) },
        pointers: inView.all.slice(inView.listed.length).map((r) => at(r.witness, 'sourceId')),
      }),
    );
  }
  if (lines.length === 0) {
    // A resumed leg whose own calls and pre-pause calls are both absent.
    lines.push(
      ctx.say('found.beforePause', {
        status: 'not-recorded',
        missing: 'before-pause',
        chips: [chip('before-pause', 'chip.beforePause')],
      }),
    );
  }
  return lines;
}
