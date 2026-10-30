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
 *
 * Each saved shape is read by its ONE reader — the verdicts by
 * `core/agent/scripts/match.ts` · `recordedBlocks`, the attached scripts by
 * `core/agent/scripts/attachment.ts` · `recordedScripts`, a call's row by
 * `core/agent/scripts/rows.ts` · `scriptRowIsWellFormed` — the rules the
 * writers and the checkpoint door share. A value no writer of
 * this library files never becomes a line; it is counted (`unread`). Each
 * kind is listed as every per-call listing of the account is (README laws 7
 * and 8): the first `MAX_LISTED_CALLS`, then one "…and N more" line.
 */

import {
  recordedScripts,
  type AttachedLabel,
  type RecordedShown,
} from '../../core/agent/scripts/attachment.js';
import { recordedBlocks, type RecordedBlock } from '../../core/agent/scripts/match.js';
import { scriptRowIsWellFormed } from '../../core/agent/scripts/rows.js';
import type { ScriptLabel } from '../../core/agent/scripts/types.js';
import { n, v } from '../render.js';
import type { TemplateId } from '../templates.js';
import type { RecordPointer, Sentence } from '../types.js';
import { isRecord, num, str, type ViewEvent } from '../view.js';
import { MAX_LISTED_CALLS } from './checked.js';
import { at, FACT_TEXT_CHARS, stateAt, type ReadContext } from './common.js';

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

/** One label → the line said about an attached script (a `submitted` call is never attached: by type, `AttachedLabel`). */
const ATTACHED_LINES: Readonly<Record<AttachedLabel, TemplateId>> = {
  returned: 'howSure.script.attached.returned',
  'reported-success': 'howSure.script.attached.reportedSuccess',
  'reported-failure': 'howSure.script.attached.reportedFailure',
  completed: 'howSure.script.attached.completed',
  'completed-with-failure': 'howSure.script.attached.completedWithFailure',
  'outcome-unknown': 'howSure.script.attached.unknown',
};

/** A call's `script` row in the committed ledger: this turn's last row of its dispatch. */
interface RowRead {
  readonly row: Readonly<Record<string, unknown>>;
  readonly pointer: (key: string) => RecordPointer;
}

/**
 * The row of one DISPATCH (`ScriptRow.dispatch`) of THIS turn — never looked
 * up by the provider's call id, which two calls of a turn may share, and never
 * without the turn (dispatches restart every turn). A row no writer of this
 * library files is `'unread'`: no line is said from it.
 */
function rowOf(ctx: ReadContext, dispatch: number): RowRead | 'unread' | undefined {
  if (ctx.view.isStateKeptOut('findingsLedger')) return undefined;
  const ledger = ctx.view.state?.findingsLedger;
  const turn = num(ctx.view.state?.turnNumber);
  if (!Array.isArray(ledger) || turn === undefined) return undefined;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const row: unknown = ledger[i];
    if (!isRecord(row) || row.kind !== 'script' || row.dispatch !== dispatch) continue;
    if (row.turn !== turn) continue;
    if (!scriptRowIsWellFormed(row)) return 'unread';
    return { row, pointer: (key) => stateAt('findingsLedger', i, key) };
  }
  return undefined;
}

/** The lines for one block the answer showed. */
function blockLines(ctx: ReadContext, e: ViewEvent, { index: i, verdict }: RecordedBlock) {
  const labelAt = at(e, 'scripts', 'blocks', i, 'label');
  if (verdict.label === 'unmatched') {
    return [ctx.say('howSure.script.unmatched', { pointers: [labelAt] })];
  }
  const read = rowOf(ctx, verdict.dispatch);
  if (read === 'unread') ctx.noteUnread();
  const found = read === 'unread' ? undefined : read;
  // A name and an id are cut where every reader of the account cuts them (law 8).
  const vars = {
    tool: v(verdict.tool, 'library', at(e, 'scripts', 'blocks', i, 'tool'), FACT_TEXT_CHARS),
    call: v(
      verdict.toolCallId,
      'library',
      at(e, 'scripts', 'blocks', i, 'toolCallId'),
      FACT_TEXT_CHARS,
    ),
  };
  const withheld = found?.row.resultWithheld === 'over-ceiling';
  const serviceError = found?.row.serviceError === true;
  const id: TemplateId =
    verdict.label === 'completed' && withheld
      ? 'howSure.script.shown.withheld'
      : verdict.label === 'outcome-unknown' && serviceError
      ? 'howSure.script.shown.unknownService'
      : SHOWN_LINES[verdict.label];
  const lines = [
    ctx.say(id, {
      // The reader checked it: `completed-with-failure` always carries its exit code.
      vars:
        verdict.exitCode !== undefined && verdict.label === 'completed-with-failure'
          ? {
              ...vars,
              exit: v(verdict.exitCode, 'library', at(e, 'scripts', 'blocks', i, 'exitCode')),
            }
          : vars,
      pointers: [labelAt, ...(found !== undefined ? [found.pointer('outcome')] : [])],
    }),
  ];
  if (withheld && verdict.label !== 'completed' && found !== undefined) {
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
  return lines;
}

/** The lines for the blocks the answer showed — `evidence_checked.scripts.blocks`. */
function shownLines(ctx: ReadContext, e: ViewEvent): Sentence[] {
  const read = recordedBlocks(e.payload.scripts);
  if (read === undefined) return [];
  for (let i = 0; i < read.unread; i++) ctx.noteUnread();
  const lines = read.blocks
    .slice(0, MAX_LISTED_CALLS)
    .flatMap((block) => blockLines(ctx, e, block));
  const hidden = read.blocks.slice(MAX_LISTED_CALLS);
  if (hidden.length > 0) {
    lines.push(
      ctx.say('howSure.script.shown.more', {
        vars: { n: n(hidden.length) },
        pointers: hidden.map((b) => at(e, 'scripts', 'blocks', b.index, 'label')),
      }),
    );
  }
  return lines;
}

/** The lines for one script the library attached. */
function attachedScriptLines(
  ctx: ReadContext,
  end: ViewEvent,
  { index: i, script }: RecordedShown,
) {
  const call = v(
    script.toolCallId,
    'library',
    at(end, 'scripts', 'shown', i, 'toolCallId'),
    FACT_TEXT_CHARS,
  );
  const bytes = v(script.bytes, 'library', at(end, 'scripts', 'shown', i, 'bytes'));
  // The reader checked it: an exit code exactly where its label proves one.
  const id = ATTACHED_LINES[script.label];
  const lines = [
    ctx.say(id, {
      vars: {
        tool: v(script.tool, 'library', at(end, 'scripts', 'shown', i, 'tool'), FACT_TEXT_CHARS),
        call,
        bytes,
        ...(script.label === 'completed-with-failure' &&
          script.exitCode !== undefined && {
            exit: v(script.exitCode, 'library', at(end, 'scripts', 'shown', i, 'exitCode')),
          }),
      },
      pointers: [at(end, 'scripts', 'shown', i, 'label')],
    }),
  ];
  if (script.truncated !== undefined) {
    lines.push(
      ctx.say('howSure.script.attached.cut', {
        vars: {
          call,
          bytes,
          shown: v(
            script.truncated.shownBytes,
            'library',
            at(end, 'scripts', 'shown', i, 'truncated', 'shownBytes'),
          ),
        },
      }),
    );
  }
  return lines;
}

/** The lines for the scripts the library attached — `turn_end.scripts`. */
function attachedLines(ctx: ReadContext): Sentence[] {
  const end = ctx.view.last('agent.turn_end');
  if (end === undefined) return [];
  const read = recordedScripts(end.payload.scripts, str(end.payload.finalContent)?.length);
  if (read === undefined) return [];
  for (let i = 0; i < read.unread; i++) ctx.noteUnread();
  const lines = read.shown
    .slice(0, MAX_LISTED_CALLS)
    .flatMap((shown) => attachedScriptLines(ctx, end, shown));
  const hidden = read.shown.slice(MAX_LISTED_CALLS);
  if (hidden.length > 0) {
    lines.push(
      ctx.say('howSure.script.attached.more', {
        vars: { n: n(hidden.length) },
        pointers: hidden.map((s) => at(end, 'scripts', 'shown', s.index, 'label')),
      }),
    );
  }
  // The programs rode the data only: the text names them and says so.
  if (read.boundary?.kind === 'unsettled' && read.shown.length > 0) {
    lines.push(
      ctx.say('howSure.script.attached.notInText', {
        vars: { n: n(read.shown.length) },
        pointers: [at(end, 'scripts', 'withheldFromText')],
      }),
    );
  }
  if (read.omitted !== undefined && read.omitted > 0) {
    lines.push(
      ctx.say('howSure.script.attached.omitted', {
        vars: { n: n(read.omitted) },
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
