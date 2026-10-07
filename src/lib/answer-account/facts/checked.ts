/**
 * Rows "It checked" and "It did not check" — one block per tool call of THIS
 * run, in call order, from what each tool DECLARED (`tools.absent` /
 * `tools.coverage_declared`). An item prints its declared `short` form, else its
 * full `what`, verbatim. More than five calls fold into `row.more@1`.
 *
 * A resumed leg never says "did not run any tools": the calls answered before
 * the pause are read from the committed state this record holds
 * (`pausedLeg.ts` · `readPausedLeg`) — each with what its tool declared, from
 * its `coverageDeclared` rows — and, when the record holds no committed
 * history, said to be out of this record.
 */

import { chip, MAX_VAR_CHARS, n, v } from '../render.js';
import type { TemplateId } from '../templates.js';
import type { Chip, RecordPointer, Sentence, SentenceVar } from '../types.js';
import {
  FACT_TEXT_CHARS,
  coverageHead,
  itemAt,
  type CallRead,
  type CallsRead,
  type CoverageItemRead,
  type CoverageRead,
  type CoverageSectionKey,
} from './calls.js';
import { at, historyAt, takeItem, type ReadContext } from './common.js';
import type { BeforePauseCall, PausedLegRead } from './pausedLeg.js';

/** Calls listed per row before folding. */
export const MAX_LISTED_CALLS = 5;

const toolOf = (call: CallRead) => call.tool;

/** What a declaration's lines need of a call — one of this leg's, or one answered before the pause. */
interface Declared {
  readonly coverage?: CoverageRead;
  readonly tool: SentenceVar;
  /** The tool name the `tool:<name>` voucher carries (cut at 200, like the fact's). */
  readonly toolName: string;
  /** Where the call is on the record — an undeclared line points here. */
  readonly pointers: readonly RecordPointer[];
}

const declaredOf = (call: CallRead): Declared => ({
  ...(call.coverage !== undefined && { coverage: call.coverage }),
  tool: call.tool,
  toolName: call.fact.toolName,
  pointers: call.fact.pointers,
});

/** A call answered before the pause, as its declaration's lines read it. */
export const declaredBeforePause = (call: BeforePauseCall): Declared => ({
  ...(call.coverage !== undefined && { coverage: call.coverage }),
  tool: call.tool,
  toolName: call.toolName.slice(0, FACT_TEXT_CHARS),
  pointers: [historyAt(call.historyIndex, '/toolName', call.toolCallId)],
});

/** The chip every line about the part before the pause carries, read from the state. */
export const heldChip = (): Chip => chip('before-pause', 'chip.beforePause.held');

/** The pointer that shows the rule that refused a call. */
function rulePointer(call: CallRead): RecordPointer | undefined {
  const e = call.ruleEvent;
  if (e === undefined) return undefined;
  if (e.type.endsWith('middleware.decision')) return at(e, 'middleware');
  if (e.type.endsWith('permission.check')) return at(e, 'policyRuleId');
  if (e.type.endsWith('checkin.decision')) return at(e, 'approved');
  return at(e, 'notExecuted');
}

function itemLines(
  ctx: ReadContext,
  call: Declared,
  section: CoverageSectionKey,
  id: { readonly short: TemplateId; readonly full: TemplateId },
): Sentence[] {
  const source = `tool:${call.toolName}` as const;
  const all = call.coverage?.items.filter((i) => i.section === section) ?? [];
  const items: CoverageItemRead[] = [];
  for (const item of all) {
    if (!takeItem(ctx, Math.min((item.short ?? item.what).length, MAX_VAR_CHARS))) break;
    items.push(item);
  }
  const lines = items.map((item: CoverageItemRead) => {
    const chips =
      item.kind === 'existence'
        ? [chip('kind', 'chip.kind.existence', 'warn')]
        : item.kind === 'scope'
        ? [chip('kind', 'chip.kind.scope')]
        : [];
    const kindPointer = item.kind !== undefined ? [itemAt(item, 'kind')] : [];
    return item.short !== undefined
      ? ctx.say(id.short, {
          vars: { short: v(item.short, source, itemAt(item, 'short')), tool: call.tool },
          pointers: [itemAt(item, 'what'), ...kindPointer],
          chips,
          item: true,
        })
      : ctx.say(id.full, {
          vars: { what: v(item.what, source, itemAt(item, 'what')), tool: call.tool },
          pointers: kindPointer,
          chips,
          item: true,
        });
  });
  const omitted = all.length - items.length;
  if (omitted > 0)
    lines.push(
      ctx.say('items.more', {
        vars: { n: n(omitted) },
        status: 'recorded',
        pointers: call.coverage ? [coverageHead(call.coverage)] : [],
        item: true,
      }),
    );
  return lines;
}

/** The one line an unnamed call gets: it is in the record, and no event names its tool. */
function unnamedLine(ctx: ReadContext, call: CallRead): Sentence {
  return ctx.say('checked.unnamed', {
    vars: { id: call.tool },
    status: 'not-recorded',
    missing: 'unreadable',
    pointers: call.fact.pointers,
  });
}

function checkedBlock(ctx: ReadContext, call: CallRead): Sentence[] {
  if (call.unnamed) return [unnamedLine(ctx, call)];
  const tool = toolOf(call);
  const by = call.fact.refusedBy;
  const rule = rulePointer(call);
  const endPointers = call.fact.pointers;
  switch (call.fact.outcome) {
    case 'failed':
      return [
        ctx.say('checked.failed', {
          vars: { tool },
          pointers: call.end ? [at(call.end, 'error')] : [],
        }),
      ];
    case 'refused':
      return [
        by !== undefined && rule !== undefined
          ? ctx.say('checked.refused', { vars: { tool, by: v(by, 'library', rule) } })
          : ctx.say('checked.refused.unnamed', {
              vars: { tool },
              pointers: rule ? [rule] : endPointers,
            }),
      ];
    case 'declined':
      return [
        ctx.say('checked.declined', { vars: { tool }, pointers: rule ? [rule] : endPointers }),
      ];
    case 'not-dispatched':
      return [ctx.say('checked.notDispatched', { vars: { tool }, pointers: endPointers })];
    case 'unknown':
      return [
        ctx.say('checked.unknown', {
          vars: { tool },
          status: 'not-recorded',
          missing: 'no-event',
          pointers: endPointers,
        }),
      ];
    case 'ran': {
      const checked = call.coverage?.items.filter((i) => i.section === 'checked') ?? [];
      if (call.coverage === undefined) {
        return [
          ctx.say('checked.undeclared', {
            vars: { tool },
            pointers: endPointers,
            chips: [chip('not-declared', 'chip.notDeclared')],
          }),
        ];
      }
      if (checked.length === 0) {
        return [
          ctx.say('checked.silent', { vars: { tool }, pointers: [coverageHead(call.coverage)] }),
        ];
      }
      return [
        ctx.say('checked.declared', {
          vars: { tool },
          pointers: [coverageHead(call.coverage)],
          chips: [chip('declared', 'chip.declared')],
        }),
        ...itemLines(ctx, declaredOf(call), 'checked', {
          short: 'checked.item',
          full: 'checked.item.full',
        }),
      ];
    }
  }
}

/**
 * The "It checked" block of a call answered BEFORE the pause — what its tool
 * declared, read from its `coverageDeclared` rows (`pausedLeg.ts`). Whether it
 * failed or was refused is in that part's events, so the line says what the
 * model read, never that the tool "ran".
 */
function checkedBeforePauseBlock(ctx: ReadContext, call: BeforePauseCall): Sentence[] {
  const d = declaredBeforePause(call);
  const checked = call.coverage?.items.filter((i) => i.section === 'checked') ?? [];
  if (call.coverage === undefined) {
    return [
      ctx.say('checked.beforePause.undeclared', {
        vars: { tool: d.tool },
        pointers: d.pointers,
        chips: [chip('not-declared', 'chip.notDeclared'), heldChip()],
      }),
    ];
  }
  if (checked.length === 0) {
    return [
      ctx.say('checked.beforePause.silent', {
        vars: { tool: d.tool },
        pointers: [coverageHead(call.coverage)],
        chips: [heldChip()],
      }),
    ];
  }
  return [
    ctx.say('checked.beforePause.declared', {
      vars: { tool: d.tool },
      pointers: [coverageHead(call.coverage)],
      chips: [chip('declared', 'chip.declared'), heldChip()],
    }),
    ...itemLines(ctx, d, 'checked', { short: 'checked.item', full: 'checked.item.full' }),
  ];
}

function notCheckedBlock(
  ctx: ReadContext,
  call: Declared,
  extra: readonly Chip[] = [],
): Sentence[] {
  const tool = call.tool;
  if (call.coverage === undefined) {
    return [
      ctx.say('notChecked.undeclared', {
        vars: { tool },
        pointers: call.pointers,
        chips: [chip('not-declared', 'chip.notDeclared'), ...extra],
      }),
    ];
  }
  const head = coverageHead(call.coverage);
  const lines: Sentence[] = [];
  const has = (section: CoverageSectionKey) =>
    (call.coverage?.items ?? []).some((i) => i.section === section);
  if (has('notChecked')) {
    lines.push(
      ctx.say('notChecked.declared', {
        vars: { tool },
        pointers: [head],
        chips: [chip('declared', 'chip.declared'), ...extra],
      }),
      ...itemLines(ctx, call, 'notChecked', {
        short: 'notChecked.item',
        full: 'notChecked.item.full',
      }),
    );
  } else {
    lines.push(
      ctx.say('notChecked.silent', { vars: { tool }, pointers: [head], chips: [...extra] }),
    );
  }
  if (has('cannotCover')) {
    lines.push(
      ctx.say('cannotCover.declared', {
        vars: { tool },
        pointers: [head],
        chips: [chip('declared', 'chip.declared'), ...extra],
      }),
      ...itemLines(ctx, call, 'cannotCover', {
        short: 'cannotCover.item',
        full: 'cannotCover.item.full',
      }),
    );
  }
  const other = call.coverage.tryInsteadTool;
  if (other !== undefined) {
    lines.push(
      ctx.say('tryInstead.tool', {
        vars: {
          tool,
          other: v(other.tool, `tool:${call.toolName}`, other.pointer, FACT_TEXT_CHARS),
        },
      }),
    );
  }
  return lines;
}

export interface CheckedRows {
  readonly checked: readonly Sentence[];
  readonly checkedMore?: Sentence;
  readonly notChecked: readonly Sentence[];
  readonly notCheckedMore?: Sentence;
}

/** The anchor a "nothing ran" line points at: the end of the turn, else its start. */
export function anchorPointer(ctx: ReadContext): RecordPointer[] {
  const anchor =
    ctx.view.last('agent.turn_end') ?? ctx.view.first('agent.turn_start') ?? ctx.view.events[0];
  return anchor === undefined
    ? []
    : [{ kind: 'event', index: anchor.index, type: anchor.type, path: '#meta/runId' }];
}

/** "…and N more tool calls from before the pause." — past `MAX_LISTED_CALLS` of them. */
export function beforePauseMore(
  ctx: ReadContext,
  before: readonly BeforePauseCall[],
): Sentence | undefined {
  const hidden = before.length - MAX_LISTED_CALLS;
  if (hidden <= 0) return undefined;
  return ctx.say('beforePause.more', {
    vars: { n: n(hidden) },
    pointers: before
      .slice(MAX_LISTED_CALLS)
      .map((c) => historyAt(c.historyIndex, '/toolName', c.toolCallId)),
    chips: [heldChip()],
  });
}

/**
 * The committed history holds no tool result from before the pause. Said as
 * exactly that — never "nothing ran": a window strategy may have dropped an
 * earlier result, and the record cannot tell the two apart. A history the
 * record keeps out (a redaction policy's placeholder) is said to be kept out.
 */
export function noResultsBeforePause(ctx: ReadContext): Sentence {
  if (ctx.view.isStateKeptOut('history')) {
    return ctx.say('beforePause.keptOut', {
      status: 'not-recorded',
      missing: 'redacted',
      chips: [heldChip()],
    });
  }
  return ctx.say('beforePause.noResults', {
    status: 'not-recorded',
    missing: 'before-pause',
    chips: [heldChip()],
  });
}

export function foldMore(ctx: ReadContext, calls: CallsRead): Sentence | undefined {
  const hidden = Math.max(0, calls.calls.length - MAX_LISTED_CALLS) + calls.omitted;
  if (hidden === 0) return undefined;
  const pointers = calls.calls.slice(MAX_LISTED_CALLS).flatMap((c) => c.fact.pointers.slice(0, 1));
  return ctx.say('row.more', {
    vars: { n: n(hidden) },
    pointers,
    status: pointers.length > 0 ? 'recorded' : 'not-recorded',
  });
}

export function readCheckedRows(
  ctx: ReadContext,
  calls: CallsRead,
  pausedLeg: PausedLegRead,
): CheckedRows {
  const listed = calls.calls.slice(0, MAX_LISTED_CALLS);
  const checked = listed.flatMap((c) => checkedBlock(ctx, c));
  // Listed: what the row PRINTS. Whether any call ran is a judgement — over every call,
  // on the outcome alone, named or not (R2-B1).
  const ranListed = listed.filter((c) => c.fact.outcome === 'ran');
  const ranAll = calls.all.filter((c) => c.fact.outcome === 'ran');
  const notChecked = ranListed.flatMap((c) =>
    c.unnamed
      ? [
          ctx.say('notChecked.unnamed', {
            vars: { id: c.tool },
            status: 'not-recorded',
            missing: 'unreadable',
            pointers: c.fact.pointers,
          }),
        ]
      : notCheckedBlock(ctx, declaredOf(c)),
  );
  if (ctx.resumedLeg && pausedLeg.stateHeld) {
    // The part before the pause, read from the committed state this record holds.
    const before = pausedLeg.calls;
    const shown = before.slice(0, MAX_LISTED_CALLS);
    checked.push(...shown.flatMap((c) => checkedBeforePauseBlock(ctx, c)));
    notChecked.push(
      ...shown.flatMap((c) => notCheckedBlock(ctx, declaredBeforePause(c), [heldChip()])),
    );
    const more = beforePauseMore(ctx, before);
    if (more !== undefined) {
      checked.push(more);
      notChecked.push(more);
    }
    if (before.length === 0) {
      checked.push(noResultsBeforePause(ctx));
      if (notChecked.length === 0) notChecked.push(noResultsBeforePause(ctx));
    }
  } else if (ctx.resumedLeg) {
    // No committed history in this record: nothing of the part before the pause can be read.
    checked.push(
      ctx.say('checked.beforePause.none', {
        status: 'not-recorded',
        missing: 'before-pause',
        chips: [chip('before-pause', 'chip.beforePause')],
      }),
    );
    notChecked.push(
      ctx.say('notChecked.beforePause', {
        status: 'not-recorded',
        missing: 'before-pause',
        chips: [chip('before-pause', 'chip.beforePause')],
      }),
    );
  } else if (calls.all.length === 0) {
    checked.push(ctx.say('checked.noCalls', { pointers: anchorPointer(ctx) }));
    notChecked.push(
      ctx.say('notChecked.noCalls', { status: 'not-applicable', pointers: anchorPointer(ctx) }),
    );
  } else if (ranAll.length === 0) {
    notChecked.push(
      ctx.say('notChecked.noneRan', {
        status: 'not-applicable',
        pointers: calls.all.flatMap((c) => c.fact.pointers.slice(-1)),
      }),
    );
  } else if (notChecked.length === 0) {
    // Calls ran, but none of the LISTED ones did: say where they are, never "none ran".
    notChecked.push(
      ctx.say('notChecked.notListed', {
        vars: { n: n(ranAll.length) },
        pointers: ranAll.flatMap((c) => c.fact.pointers.slice(0, 1)),
      }),
    );
  }
  const more = foldMore(ctx, calls);
  return {
    checked,
    notChecked,
    ...(more !== undefined && { checkedMore: more, notCheckedMore: more }),
  };
}
