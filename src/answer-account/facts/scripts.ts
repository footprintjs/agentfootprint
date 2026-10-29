/**
 * The "How sure" row's script lines — one per fenced block the answer SHOWED
 * (`.namesAndNumbersFromEvidence({ code: 'match' })`) and one per script the
 * library ATTACHED (`.scriptTravelsWithTheAnswer()`).
 *
 * Read from the record, never rebuilt from text: a shown block's verdict is
 * the answering iteration's `agent.evidence_checked.scripts`; an attached
 * script is `agent.turn_end.scripts`; the details a label's words need (a
 * service error, a withheld result, a before-tool rewrite) are the call's own
 * `script` row in the committed `findingsLedger`. F1 ("this is the script
 * submitted") and F2 ("this script ran") are said; F3 stays the evidence
 * lines' — no sentence here joins a script to a value.
 *
 * The program itself is never printed and never shown: it is a tool
 * argument (`shown.ts` keeps `text` off every allow-list).
 */

import type { ScriptLabel } from '../../core/agent/scripts/types.js';
import { n, v } from '../render.js';
import type { TemplateId } from '../templates.js';
import type { RecordPointer, Sentence } from '../types.js';
import { isRecord, num, str, type ViewEvent } from '../view.js';
import { at, stateAt, toolVar, type ReadContext } from './common.js';

/** One label → the line said about a shown block that matched a call. */
const SHOWN_LINES: Readonly<Record<ScriptLabel, TemplateId>> = {
  submitted: 'howSure.script.shown.submitted',
  returned: 'howSure.script.shown.returned',
  'reported-success': 'howSure.script.shown.reportedSuccess',
  'reported-failure': 'howSure.script.shown.reportedFailure',
  completed: 'howSure.script.shown.completed',
  'completed-with-failure': 'howSure.script.shown.completedWithFailure',
  'outcome-unknown': 'howSure.script.shown.unknown',
};

/** One label → the line said about an attached script (a `submitted` call is never attached). */
const ATTACHED_LINES: Readonly<Partial<Record<ScriptLabel, TemplateId>>> = {
  returned: 'howSure.script.attached.returned',
  'reported-success': 'howSure.script.attached.reportedSuccess',
  'reported-failure': 'howSure.script.attached.reportedFailure',
  completed: 'howSure.script.attached.completed',
  'completed-with-failure': 'howSure.script.attached.completedWithFailure',
  'outcome-unknown': 'howSure.script.attached.unknown',
};

/** A call's `script` row in the committed ledger: this turn's last row for it. */
interface RowRead {
  readonly row: Readonly<Record<string, unknown>>;
  readonly pointer: (key: string) => RecordPointer;
}

function rowOf(ctx: ReadContext, toolCallId: string): RowRead | undefined {
  if (ctx.view.isStateKeptOut('findingsLedger')) return undefined;
  const ledger = ctx.view.state?.findingsLedger;
  if (!Array.isArray(ledger)) return undefined;
  const turn = num(ctx.view.state?.turnNumber);
  for (let i = ledger.length - 1; i >= 0; i--) {
    const row: unknown = ledger[i];
    if (!isRecord(row) || row.kind !== 'script' || row.toolCallId !== toolCallId) continue;
    if (turn !== undefined && row.turn !== turn) continue;
    return { row, pointer: (key) => stateAt('findingsLedger', i, key) };
  }
  return undefined;
}

function isLabel(value: unknown): value is ScriptLabel {
  return typeof value === 'string' && Object.hasOwn(SHOWN_LINES, value);
}

/** The lines for the blocks the answer showed — `evidence_checked.scripts.blocks`. */
function shownLines(ctx: ReadContext, e: ViewEvent): Sentence[] {
  const scripts = e.payload.scripts;
  if (!isRecord(scripts) || !Array.isArray(scripts.blocks)) return [];
  const lines: Sentence[] = [];
  scripts.blocks.forEach((block: unknown, i) => {
    if (!isRecord(block)) {
      ctx.noteUnread();
      return;
    }
    const labelAt = at(e, 'scripts', 'blocks', i, 'label');
    if (block.label === 'unmatched') {
      lines.push(ctx.say('howSure.script.unmatched', { pointers: [labelAt] }));
      return;
    }
    const tool = str(block.tool);
    const call = str(block.toolCallId);
    if (!isLabel(block.label) || tool === undefined || call === undefined) {
      ctx.noteUnread();
      return;
    }
    const found = rowOf(ctx, call);
    const vars = {
      tool: toolVar(tool, at(e, 'scripts', 'blocks', i, 'tool')),
      call: v(call, 'library', at(e, 'scripts', 'blocks', i, 'toolCallId')),
    };
    const withheld = found?.row.resultWithheld === 'over-ceiling';
    const serviceError = found?.row.serviceError === true;
    const exit = num(block.exitCode);
    const id: TemplateId =
      block.label === 'completed' && withheld
        ? 'howSure.script.shown.withheld'
        : block.label === 'outcome-unknown' && serviceError
        ? 'howSure.script.shown.unknownService'
        : SHOWN_LINES[block.label];
    lines.push(
      ctx.say(id, {
        vars:
          block.label === 'completed-with-failure' && exit !== undefined
            ? { ...vars, exit: v(exit, 'library', at(e, 'scripts', 'blocks', i, 'exitCode')) }
            : vars,
        pointers: [labelAt, ...(found !== undefined ? [found.pointer('outcome')] : [])],
      }),
    );
    if (withheld && block.label !== 'completed' && found !== undefined) {
      lines.push(
        ctx.say('howSure.script.withheld', {
          vars: { call: vars.call },
          pointers: [found.pointer('resultWithheld')],
        }),
      );
    }
    if (found?.row.rewritten === true) {
      lines.push(
        ctx.say('howSure.script.rewritten', {
          vars: { call: vars.call },
          pointers: [found.pointer('rewritten')],
        }),
      );
    }
  });
  return lines;
}

/** The lines for the scripts the library attached — `turn_end.scripts`. */
function attachedLines(ctx: ReadContext): Sentence[] {
  const end = ctx.view.last('agent.turn_end');
  const scripts = end?.payload.scripts;
  if (end === undefined || !isRecord(scripts) || !Array.isArray(scripts.shown)) return [];
  const lines: Sentence[] = [];
  scripts.shown.forEach((shown: unknown, i) => {
    const tool = isRecord(shown) ? str(shown.tool) : undefined;
    const callId = isRecord(shown) ? str(shown.toolCallId) : undefined;
    const bytes = isRecord(shown) ? num(shown.bytes) : undefined;
    if (!isRecord(shown) || !isLabel(shown.label) || tool === undefined || callId === undefined) {
      ctx.noteUnread();
      return;
    }
    if (bytes === undefined) {
      ctx.noteUnread();
      return;
    }
    const cut = isRecord(shown.truncated) ? num(shown.truncated.shownBytes) : undefined;
    const id = ATTACHED_LINES[shown.label];
    const exit = num(shown.exitCode);
    if (id === undefined || (shown.label === 'completed-with-failure' && exit === undefined)) {
      ctx.noteUnread();
      return;
    }
    const call = v(callId, 'library', at(end, 'scripts', 'shown', i, 'toolCallId'));
    const bytesVar = v(bytes, 'library', at(end, 'scripts', 'shown', i, 'bytes'));
    lines.push(
      ctx.say(id, {
        vars: {
          tool: toolVar(tool, at(end, 'scripts', 'shown', i, 'tool')),
          call,
          bytes: bytesVar,
          ...(shown.label === 'completed-with-failure' &&
            exit !== undefined && {
              exit: v(exit, 'library', at(end, 'scripts', 'shown', i, 'exitCode')),
            }),
        },
        pointers: [at(end, 'scripts', 'shown', i, 'label')],
      }),
    );
    if (cut !== undefined) {
      lines.push(
        ctx.say('howSure.script.attached.cut', {
          vars: {
            call,
            bytes: bytesVar,
            shown: v(cut, 'library', at(end, 'scripts', 'shown', i, 'truncated', 'shownBytes')),
          },
        }),
      );
    }
  });
  const omitted = num(scripts.omitted);
  if (omitted !== undefined && omitted > 0) {
    lines.push(
      ctx.say('howSure.script.attached.omitted', {
        vars: { n: n(omitted) },
        pointers: [at(end, 'scripts', 'omitted')],
      }),
    );
  }
  return lines;
}

/**
 * Every script line of the answer: the shown blocks (when the answering
 * iteration's verdict carries them), then the attached scripts. Empty on a
 * record without either arm.
 */
export function scriptLines(ctx: ReadContext, evidence: ViewEvent | undefined): Sentence[] {
  return [...(evidence !== undefined ? shownLines(ctx, evidence) : []), ...attachedLines(ctx)];
}
