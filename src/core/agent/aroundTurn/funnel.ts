/**
 * The one funnel every top-level turn of an Agent passes through.
 *
 * With no wrapper this hands straight to the leg, adding no await. With one,
 * the wrapper may wrap the turn and ask for the named changes; it cannot
 * change how the turn ended. See ./README.md for the table of what happens
 * when a wrapper misbehaves.
 */

import type { AgentAroundTurnFailedPayload } from '../../../events/payloads/agent.js';
import { AroundTurnError, type AroundTurnRefusal } from './errors.js';
import { readOnlyCopy } from './readOnlyCopy.js';
import type { AgentTurn, AroundTurn, ProceedWithTurn, RunTurn, TurnChanges } from './types.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]{0,127}$/;
/** Nothing noted yet. Not `undefined`: a wrapper may throw `undefined`. */
const NOTHING_NOTED = Symbol('nothing noted');

/** The class of a thrown value, or a fixed word. Never its message, and never throws. */
function errorClassOf(thrown: unknown): string {
  try {
    if (!(thrown instanceof Error)) return 'non-error';
    const name: unknown = thrown.constructor?.name;
    return typeof name === 'string' && IDENTIFIER.test(name) ? name : 'Error';
  } catch {
    return 'Error';
  }
}

function changeProblem(
  kind: AgentTurn['kind'],
  changes: TurnChanges | undefined,
): AroundTurnRefusal | undefined {
  if (changes === undefined) return undefined;
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes))
    return 'unknown-change';
  const named = Object.keys(changes);
  if (named.length === 0) return undefined;
  if (kind === 'resume') return 'change-on-resume';
  return named.every((key) => key === 'time') ? undefined : 'unknown-change';
}

function readOnlyTurn(turn: AgentTurn): AgentTurn {
  return turn.kind === 'run'
    ? Object.freeze({
        ...turn,
        input: readOnlyCopy(turn.input),
        options: readOnlyCopy(turn.options),
      })
    : Object.freeze({
        ...turn,
        checkpoint: readOnlyCopy(turn.checkpoint),
        answer: readOnlyCopy(turn.answer),
        options: readOnlyCopy(turn.options),
      });
}

type Settled<O> = { readonly value: O } | { readonly error: unknown };

/**
 * Finishes the turn's run once its leg has settled: the run's finalizers (the
 * recording filed, resources closed) run here, inside the wrapper's context and
 * before `proceed` resolves. `legFailed` says the leg rejected, so a failure
 * in the turn's own work is never finished as a completed or paused run.
 */
export type FinishTurn = (legFailed: boolean) => Promise<void>;

/** The leg's outcome once the turn is finished. The leg's own error outranks a cleanup failure. */
async function filed<O>(outcome: Settled<O>, finish: FinishTurn): Promise<Settled<O>> {
  try {
    await finish('error' in outcome);
    return outcome;
  } catch (error) {
    return 'error' in outcome ? outcome : { error };
  }
}

async function wrapped<O>(
  port: AroundTurn,
  turn: AgentTurn,
  leg: (changes: TurnChanges | undefined) => Promise<O>,
  finish: FinishTurn,
  report: (failure: AgentAroundTurnFailedPayload) => void,
): Promise<O> {
  const { name } = port;
  let running: Promise<void> | undefined;
  // Taken before any code the wrapper can reach runs: a `time` getter may call `proceed`.
  let claimed = false;
  let settled: Settled<O> | undefined;
  let wrapperOpen = true;
  let lastNoted: unknown = NOTHING_NOTED;
  const note = (error: unknown): void => {
    if (error === lastNoted) return;
    lastNoted = error;
    try {
      report({ wrapper: name, errorClass: errorClassOf(error) });
    } catch {
      // A failure to report can never change the outcome.
    }
  };
  // Handled here so a wrapper that never awaits cannot crash the process.
  const handled = (promise: Promise<void>): Promise<void> => {
    promise.catch(() => undefined);
    return promise;
  };
  const refused = (reason: AroundTurnRefusal): Promise<void> => {
    const error = new AroundTurnError(reason, name);
    if (claimed) note(error);
    return handled(Promise.reject(error));
  };
  const proceed: ProceedWithTurn = (changes) => {
    if (!wrapperOpen) return refused('late-proceed');
    if (claimed) return refused('second-proceed');
    claimed = true;
    let problem: AroundTurnRefusal | undefined;
    try {
      problem = changeProblem(turn.kind, changes);
    } catch (error) {
      // A Proxy's trap threw. No leg started, so the wrapper may still call again.
      claimed = false;
      return handled(Promise.reject(error));
    }
    if (problem !== undefined) {
      claimed = false;
      return refused(problem);
    }
    running = (async () => leg(changes))()
      .then(
        (value): Settled<O> => ({ value }),
        (error: unknown): Settled<O> => ({ error }),
      )
      .then(async (outcome) => {
        settled = await filed(outcome, finish);
        if ('error' in settled) throw settled.error;
      });
    return handled(running);
  };

  let thrown: { readonly error: unknown } | undefined;
  try {
    await port.around(readOnlyTurn(turn), proceed);
  } catch (error) {
    thrown = { error };
  }
  wrapperOpen = false;

  const run = running as Promise<void> | undefined;
  if (run === undefined) {
    throw thrown !== undefined ? thrown.error : new AroundTurnError('not-proceeded', name);
  }
  // The turn holds its lease until the run itself is over, awaited or not.
  await run.catch(() => undefined);
  const outcome = settled as Settled<O>;
  const runError = 'error' in outcome ? outcome : undefined;
  if (thrown !== undefined && (runError === undefined || thrown.error !== runError.error))
    note(thrown.error);
  if (runError !== undefined) throw runError.error;
  return (outcome as { readonly value: O }).value;
}

/**
 * The funnel. `undefined` is an agent with no wrapper: the leg, with nothing
 * added, and the lease finishes the run as before. With a wrapper, `proceed`
 * resolves only after `finish` has run.
 */
export function throughAroundTurn<O>(
  port: AroundTurn | undefined,
  turn: AgentTurn,
  leg: (changes: TurnChanges | undefined) => Promise<O>,
  finish: FinishTurn,
  report: (failure: AgentAroundTurnFailedPayload) => void,
): Promise<O> {
  return port === undefined ? leg(undefined) : wrapped(port, turn, leg, finish, report);
}

function isFieldBag(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The input a run starts from once a wrapper's changes are applied. No `time`
 * is the input itself. An input the run would refuse is left for it to refuse;
 * a malformed `time` reaches the run's own reader, which refuses it by name.
 */
export function runInputWith(
  input: RunTurn['input'],
  options: RunTurn['options'],
  changes: TurnChanges | undefined,
): RunTurn['input'] {
  const time: unknown = changes?.time;
  if (time === undefined) return input;
  const bag: unknown = typeof input === 'string' ? { message: input } : input;
  if (!isFieldBag(bag)) return input;
  const stated: unknown = bag.time ?? options?.time;
  const merged = !isFieldBag(time)
    ? time
    : {
        ...(isFieldBag(stated) && stated),
        ...Object.fromEntries(Object.entries(time).filter(([, field]) => field !== undefined)),
      };
  return { ...bag, time: merged } as RunTurn['input'];
}
