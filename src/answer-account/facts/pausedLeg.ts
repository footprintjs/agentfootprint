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
 * tools declared (`core/agent/types/state/records.ts` · `coverageDeclared` — a
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
 *   - RECOVERABLE TOO — the routing verdict: RouteTurn commits `turnRoute`
 *     and the scorer's `entryScores` before the loop, so the state the run
 *     paused with holds them (`understood.ts` · `routingVerdictOf`). Only
 *     what the state does not carry is missing: whether the verdict was
 *     decisive and the decider's model.
 *   - NOT RECOVERABLE — that part's events: what was in front of the model
 *     on each earlier iteration, a rule's verdict on a call (failed, refused,
 *     withheld), and timings. The rows that need them say so
 *     (`wrong.beforePause.held.events`; `understood.resumed` and
 *     `wrong.beforePause.held` only when the state holds no verdict either).
 *
 * A record that does not hold the paused state (`stateHeld: false` — an
 * older or trimmed recording, or a leg the record only LOOKS resumed in) reads
 * nothing of the part before the pause, and the rows say it is not in this
 * record.
 */

import {
  historyStartsWith,
  readHistoryCalls,
  rowsForHistoryCall,
} from '../../core/agent/recordedCalls.js';
import { toolBytesOf } from '../../lib/toolBytes.js';
import { v } from '../render.js';
import type { SentenceVar } from '../types.js';
import {
  COVERAGE_STATE_KEY,
  readStateCoverage,
  type CallsRead,
  type CoverageRead,
} from './calls.js';
import {
  FACT_TEXT_CHARS,
  historyAt,
  historyOf,
  readEmptiness,
  rowsAtOf,
  type EmptinessReading,
  type ReadContext,
} from './common.js';
import { isPersonEntry } from '../../lib/saidByPerson.js';

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
  const before = pausedWith.history as readonly unknown[];
  const history = historyOf(ctx.view);
  if (!historyStartsWith(history, before)) return { stateHeld: true, calls: [] };
  const coverageRows = ctx.view.state?.[COVERAGE_STATE_KEY];
  const rows: readonly unknown[] = Array.isArray(coverageRows) ? coverageRows : [];
  const all = readHistoryCalls(history);
  let current = -1;
  for (let index = before.length - 1; index >= 0; index--) {
    if (isPersonEntry(before[index])) {
      current = index;
      break;
    }
  }
  const out: BeforePauseCall[] = [];
  for (const occurrence of all) {
    const { providerId: id, toolName: name, index: i, message: m } = occurrence;
    if (
      i <= current ||
      i >= before.length ||
      calls.historyIndices.has(i) ||
      id === undefined ||
      name === undefined
    )
      continue;
    const attributed = rowsForHistoryCall(rows, all, occurrence);
    const coverage = readStateCoverage(attributed, ctx.view.servedUnderPolicy);
    const rowsAt = rowsAtOf(ctx.declarations, name);
    // The declaration and emptiness both use these same occurrence rows.
    const mine = attributed.map(({ row }) => row);
    const reading = readEmptiness(toolBytesOf({ content: m.content, toolChars: m.toolChars }), {
      placement: { toolCallId: id, issued: ctx.view.issuedPlacements },
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
