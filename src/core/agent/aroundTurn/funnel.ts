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

async function wrapped<O>(
  port: AroundTurn,
  turn: AgentTurn,
  leg: (changes: TurnChanges | undefined) => Promise<O>,
  report: (failure: AgentAroundTurnFailedPayload) => void,
): Promise<O> {
  const { name } = port;
  let running: Promise<void> | undefined;
  let settled: { readonly value: O } | { readonly error: unknown } | undefined;
  let wrapperOpen = true;
  let lastNoted: unknown;
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
    if (running !== undefined) note(error);
    return handled(Promise.reject(error));
  };
  const proceed: ProceedWithTurn = (changes) => {
    if (!wrapperOpen) return refused('late-proceed');
    if (running !== undefined) return refused('second-proceed');
    const problem = changeProblem(turn.kind, changes);
    if (problem !== undefined) return refused(problem);
    running = (async () => leg(changes))().then(
      (value) => {
        settled = { value };
      },
      (error: unknown) => {
        settled = { error };
        throw error;
      },
    );
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
  const outcome = settled as { readonly value: O } | { readonly error: unknown };
  const runError = 'error' in outcome ? outcome : undefined;
  if (thrown !== undefined && (runError === undefined || thrown.error !== runError.error))
    note(thrown.error);
  if (runError !== undefined) throw runError.error;
  return (outcome as { readonly value: O }).value;
}

/** The funnel. `undefined` is an agent with no wrapper: the leg, with nothing added. */
export function throughAroundTurn<O>(
  port: AroundTurn | undefined,
  turn: AgentTurn,
  leg: (changes: TurnChanges | undefined) => Promise<O>,
  report: (failure: AgentAroundTurnFailedPayload) => void,
): Promise<O> {
  return port === undefined ? leg(undefined) : wrapped(port, turn, leg, report);
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
