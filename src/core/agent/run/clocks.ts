import {
  draftClock,
  readRunTime,
  type ClockDraft,
  type ReadRunTime,
  type ReadTimeOptions,
} from '../../../time/clock.js';
import { clockOf } from '../../../time/rows.js';
import type { TimeAnswerContext } from '../../../tools/inputRequest.js';
import { InvalidRunInputError } from '../../runInput.js';
import type { AgentState } from '../types.js';
import type { AgentRunValues } from '../runValues.js';

/**
 * A run's `time`, read into the turn's clock draft (the time layer) — or
 * refused, before the turn starts: `time` on an agent without `.time()` or
 * a malformed value. No zone anywhere (the run's, else the builder's) is no
 * refusal: the zone is UNKNOWN (`zoneSource: 'unknown'`, G15) — never the
 * server's, never guessed; the person is asked it before any time they
 * wrote is read. `undefined` on an agent without the layer.
 *
 * @internal
 */
export function draftAgentClock(
  time: unknown,
  runner: string,
  timeOptions: ReadTimeOptions | undefined,
): ClockDraft | undefined {
  const passed = readAgentTime(time, runner, timeOptions);
  if (timeOptions === undefined) return undefined;
  return draftClock(passed, timeOptions);
}

/**
 * The clock draft seed stamps (the time layer): the one `run()` read — or,
 * for a turn this agent's `run()` did not start (its chart mounted in a
 * composition, which passes no `time`), the builder's fallback zone with
 * the turn's start as `now` (`zoneSource: 'builder'`, `nowSource:
 * 'default'` — the same record a `run()` with no `time` files). With no
 * fallback zone that turn's zone is unknown, as a `run()`'s is (G15): the
 * server's zone is never used.
 *
 * @internal
 */
export function clockForSeed(
  values: AgentRunValues,
  timeOptions: ReadTimeOptions | undefined,
): ClockDraft {
  if (values.clockDraft !== undefined) return values.clockDraft;
  return draftClock(undefined, timeOptions ?? {});
}

/**
 * A `time` passed to a run or a resume, read — or refused by name: passed to
 * an agent without `.time()` (a door that ignored it would look configured
 * and do nothing), or malformed.
 *
 * @internal
 */
export function readAgentTime(
  time: unknown,
  runner: string,
  timeOptions: ReadTimeOptions | undefined,
): ReadRunTime | undefined {
  if (time === undefined) return undefined;
  if (timeOptions === undefined) {
    throw new InvalidRunInputError({
      runner,
      received: 'time',
      hint: 'this agent reads no clock — arm the time layer with .time() to pass time',
    });
  }
  const read = readRunTime(time);
  if ('problem' in read) {
    throw new InvalidRunInputError({ runner, received: 'a malformed time', hint: read.problem });
  }
  return read.value;
}

/**
 * What the resume door checks a time field's answer with (the time design
 * § 6.2, step T4): the paused turn's clock zone — the kept `clock` row, so
 * a resume that passes another `time` changes nothing — and the app's
 * catalog overrides. `undefined` without `.time()`: a `format` field is
 * then judged for shape, order and offset only, in the default words.
 *
 * @internal
 */
export function agentTimeAnswerContext(
  state: unknown,
  timeOptions: ReadTimeOptions | undefined,
): TimeAnswerContext | undefined {
  if (timeOptions === undefined) return undefined;
  const ledger = (state as Partial<AgentState> | undefined)?.findingsLedger;
  const clock = clockOf(Array.isArray(ledger) ? ledger : undefined);
  // An unknown zone (G15) judges no wall time: `zone` is then only the UTC spelling.
  const zone = clock?.zoneSource === 'unknown' ? undefined : clock?.zone;
  const messages = timeOptions.messages;
  return {
    ...(zone !== undefined && { zone }),
    ...(messages !== undefined && { messages }),
  };
}
