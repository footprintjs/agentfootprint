/**
 * What THIS record carries of the part of an answer before a pause — read off
 * the record, never assumed absent.
 *
 * A resumed leg's recording holds that leg's EVENTS only (`view.ts` keeps one
 * run's). It also holds the state the run PAUSED with — `snapshot.initialState`
 * (footprintjs: the resumed leg's fold base; a fresh run's is empty) — and the
 * committed state after it, which carries the part before the pause forward:
 * `sharedState.history` keeps each call answered before the pause with what
 * came back, and the tracked `coverageDeclared` rows keep what each of those
 * tools declared (`core/agent/types.ts` · `coverageDeclared` — a
 * limit is a fact about the answer, so it rides every recording).
 *
 * The boundary is the paused state itself: a call before the pause is a tool
 * message in `initialState.history` after its last person entry (the request
 * the run was answering when it paused) that is not a call of this leg. Its
 * bytes and declaration are read where a pointer can land — the committed
 * `sharedState` (matched by call id) — and a call the committed history no
 * longer holds is passed over, never guessed.
 *
 * So, exactly:
 *   - RECOVERABLE — each call answered before the pause; what came back, read
 *     by the ONE emptiness reader over the tool's own bytes with the door the
 *     state holds (its `coverageDeclared` rows: an `absence` row, a `ledger`
 *     boundary); what its tool declared it checked, did not check and can
 *     never cover.
 *   - NOT RECOVERABLE — that part's events: the routing verdict and its
 *     scores, what was in front of the model on each earlier iteration, a
 *     rule's verdict on a call (failed, refused, withheld), and timings. The
 *     rows that need them say so (`understood.resumed`,
 *     `wrong.beforePause.held`).
 *
 * A record that does not hold the paused state (`stateHeld: false` — an
 * older or trimmed recording, or a leg the record only LOOKS resumed in) reads
 * nothing of the part before the pause, and the rows say it is not in this
 * record.
 */

import { toolBytesOf } from '../../toolBytes.js';
import { v } from '../render.js';
import type { SentenceVar } from '../types.js';
import { isRecord, str } from '../view.js';
import {
  COVERAGE_STATE_KEY,
  FACT_TEXT_CHARS,
  readStateCoverage,
  type CallsRead,
  type CoverageRead,
} from './calls.js';
import {
  historyAt,
  historyOf,
  isPersonEntry,
  readEmptiness,
  rowsAtOf,
  type EmptinessReading,
  type ReadContext,
} from './common.js';

/** One call answered before the pause, as the committed state keeps it. */
export interface BeforePauseCall {
  readonly toolName: string;
  readonly toolCallId: string;
  /** Its tool message in `sharedState.history`. */
  readonly historyIndex: number;
  /** The tool's name as a sentence var — clipped at `FACT_TEXT_CHARS`, pointing at its history message. */
  readonly tool: SentenceVar;
  /** What came back, as the model read it — the tool's own bytes, through the one emptiness reader. */
  readonly reading: EmptinessReading;
  /** What its tool declared, read from its `coverageDeclared` rows; absent when it declared nothing. */
  readonly coverage?: CoverageRead;
}

export interface PausedLegRead {
  /** The record holds the state the run paused with (`snapshot.initialState`) — the part before the pause is read from it. */
  readonly stateHeld: boolean;
  /** Every call answered before the pause, in history order — none when the leg was not resumed. */
  readonly calls: readonly BeforePauseCall[];
}

const NOT_RESUMED: PausedLegRead = { stateHeld: false, calls: [] };

/**
 * On a resumed leg: the part before the pause, read from the committed state
 * this record holds — the calls in history after the person's current request
 * that are not calls of this leg, each with what came back and what its tool
 * declared.
 */
export function readPausedLeg(ctx: ReadContext, calls: CallsRead): PausedLegRead {
  const pausedWith = ctx.view.pausedWith;
  if (!ctx.resumedLeg || pausedWith === undefined) return NOT_RESUMED;
  const before = pausedHistory(pausedWith.history as readonly unknown[]);
  const history = historyOf(ctx.view);
  const coverageRows = ctx.view.state?.[COVERAGE_STATE_KEY];
  const rows: readonly unknown[] = Array.isArray(coverageRows) ? coverageRows : [];
  const out: BeforePauseCall[] = [];
  for (const id of before) {
    if (calls.ids.has(id)) continue;
    const i = history.findIndex((m) => isRecord(m) && m.role === 'tool' && m.toolCallId === id);
    const m = history[i];
    if (!isRecord(m)) continue;
    const name = str(m.toolName);
    if (name === undefined) continue;
    const coverage = readStateCoverage(rows, id);
    const rowsAt = rowsAtOf(ctx.declarations, name);
    // The door this record holds for the call is its committed declaration — the same rows the
    // standing fold reads (`assessment/assess.ts`), so the two cannot disagree about it.
    const mine = rows.filter((r) => isRecord(r) && r.toolCallId === id) as readonly {
      readonly kind?: unknown;
    }[];
    const reading = readEmptiness(toolBytesOf({ content: m.content, toolChars: m.toolChars }), {
      ...(rowsAt !== undefined && { rowsAt }),
      ...(mine.length > 0 && {
        door: {
          absent: mine.some((r) => r.kind === 'absence'),
          bounded: mine.some((r) => r.kind === 'ledger'),
        },
      }),
    });
    out.push({
      toolName: name,
      toolCallId: id,
      historyIndex: i,
      tool: v(name, 'library', historyAt(i, '/toolName', id), FACT_TEXT_CHARS),
      reading,
      ...(coverage !== undefined && { coverage }),
    });
  }
  return { stateHeld: true, calls: out };
}

/** The call ids of the tool messages after the last person entry of the paused state's history. */
function pausedHistory(history: readonly unknown[]): readonly string[] {
  let current = -1;
  history.forEach((m, i) => {
    if (isPersonEntry(m)) current = i;
  });
  const ids: string[] = [];
  history.forEach((m, i) => {
    if (i <= current || !isRecord(m) || m.role !== 'tool') return;
    const id = str(m.toolCallId);
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  });
  return ids;
}
