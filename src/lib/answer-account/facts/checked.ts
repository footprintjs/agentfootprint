/**
 * Rows "It checked" and "It did not check" — one block per tool call of THIS
 * run, in call order, from what each tool DECLARED (`tools.absent` /
 * `tools.coverage_declared`). An item prints its declared `short` form, else its
 * full `what`, verbatim. More than five calls fold into `row.more@1`.
 *
 * A resumed leg never says "did not run any tools": the calls answered before
 * the pause are named from `history` (tool messages after the current user
 * message that are not calls of this run) and said to be out of this record.
 */

import { chip, MAX_VAR_CHARS, n, v } from '../render.js';
import type { TemplateId } from '../templates.js';
import type { RecordPointer, Sentence } from '../types.js';
import { isRecord, str } from '../view.js';
import {
  coverageHead,
  itemAt,
  type CallRead,
  type CallsRead,
  type CoverageItemRead,
  type CoverageSectionKey,
} from './calls.js';
import { at, historyAt, historyOf, takeItem, toolVar, type ReadContext } from './common.js';

/** Calls listed per row before folding. */
export const MAX_LISTED_CALLS = 5;

export interface BeforePauseCall {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly historyIndex: number;
}

/** On a resumed leg: tool results in history after the current user message, not of this run. */
export function readBeforePause(ctx: ReadContext, calls: CallsRead): BeforePauseCall[] {
  if (!ctx.resumedLeg) return [];
  const history = historyOf(ctx.view);
  let current = -1;
  history.forEach((m, i) => {
    if (isRecord(m) && m.role === 'user') current = i;
  });
  const out: BeforePauseCall[] = [];
  history.forEach((m, i) => {
    if (i <= current || !isRecord(m) || m.role !== 'tool') return;
    const id = str(m.toolCallId);
    const name = str(m.toolName);
    if (id !== undefined && name !== undefined && !calls.ids.has(id)) {
      out.push({ toolName: name, toolCallId: id, historyIndex: i });
    }
  });
  return out;
}

const toolOf = (call: CallRead): ReturnType<typeof toolVar> =>
  toolVar(call.fact.toolName, call.toolPointer);

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
  call: CallRead,
  section: CoverageSectionKey,
  id: { readonly short: TemplateId; readonly full: TemplateId },
): Sentence[] {
  const source = `tool:${call.fact.toolName}` as const;
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
          vars: { short: v(item.short, source, itemAt(item, 'short')), tool: toolOf(call) },
          pointers: [itemAt(item, 'what'), ...kindPointer],
          chips,
          item: true,
        })
      : ctx.say(id.full, {
          vars: { what: v(item.what, source, itemAt(item, 'what')), tool: toolOf(call) },
          pointers: kindPointer,
          chips,
          item: true,
        });
  });
  const omitted = (call.coverage?.omitted[section] ?? 0) + (all.length - items.length);
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

function checkedBlock(ctx: ReadContext, call: CallRead): Sentence[] {
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
        ...itemLines(ctx, call, 'checked', { short: 'checked.item', full: 'checked.item.full' }),
      ];
    }
  }
}

function notCheckedBlock(ctx: ReadContext, call: CallRead): Sentence[] {
  const tool = toolOf(call);
  if (call.coverage === undefined) {
    return [
      ctx.say('notChecked.undeclared', {
        vars: { tool },
        pointers: call.fact.pointers,
        chips: [chip('not-declared', 'chip.notDeclared')],
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
        chips: [chip('declared', 'chip.declared')],
      }),
      ...itemLines(ctx, call, 'notChecked', {
        short: 'notChecked.item',
        full: 'notChecked.item.full',
      }),
    );
  } else {
    lines.push(ctx.say('notChecked.silent', { vars: { tool }, pointers: [head] }));
  }
  if (has('cannotCover')) {
    lines.push(
      ctx.say('cannotCover.declared', {
        vars: { tool },
        pointers: [head],
        chips: [chip('declared', 'chip.declared')],
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
          other: v(
            other.tool,
            `tool:${call.fact.toolName}`,
            at(other.event, 'tryInsteadTool', 'tool'),
          ),
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
  beforePause: readonly BeforePauseCall[],
): CheckedRows {
  const listed = calls.calls.slice(0, MAX_LISTED_CALLS);
  const checked = listed.flatMap((c) => checkedBlock(ctx, c));
  const ran = listed.filter((c) => c.fact.outcome === 'ran');
  const notChecked = ran.flatMap((c) => notCheckedBlock(ctx, c));
  if (ctx.resumedLeg) {
    const names = [...new Set(beforePause.map((c) => c.toolName))];
    const pointers = beforePause.map((c) => historyAt(c.historyIndex, '/toolName', c.toolCallId));
    checked.push(
      names.length > 0
        ? ctx.say('checked.beforePause', {
            vars: { n: n(names.length), names: v(names.join(', '), 'library') },
            pointers,
            chips: [chip('before-pause', 'chip.beforePause')],
          })
        : ctx.say('checked.beforePause.none', {
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
  } else if (calls.calls.length === 0) {
    checked.push(ctx.say('checked.noCalls', { pointers: anchorPointer(ctx) }));
    notChecked.push(
      ctx.say('notChecked.noCalls', { status: 'not-applicable', pointers: anchorPointer(ctx) }),
    );
  } else if (ran.length === 0 && notChecked.length === 0) {
    notChecked.push(
      ctx.say('notChecked.noneRan', {
        status: 'not-applicable',
        pointers: listed.flatMap((c) => c.fact.pointers),
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
