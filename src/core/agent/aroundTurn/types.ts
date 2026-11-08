/**
 * The shapes of `.aroundTurn()` — what a wrapper is handed and what it may ask.
 */

import type { FlowchartCheckpoint } from 'footprintjs';
import type { RunTime } from '../../../time/clock.js';
import type { AgentRunOptions } from '../../Agent.js';
import type { AgentInput } from '../types.js';

/**
 * A new turn: what `run`, `runTyped`, `followUp`, `resumeOnError` and a hosted
 * message hand the agent. A read-only copy — editing it fails, and could not
 * reach the run. The one change a wrapper may ask for is {@link TurnChanges}.
 */
export interface RunTurn {
  readonly kind: 'run';
  readonly input: AgentInput | string;
  readonly options: AgentRunOptions | undefined;
}

/**
 * A paused turn being answered: what `resume` and a hosted answer hand the
 * agent. A read-only copy. A resume accepts no change: the paused turn keeps
 * its clock and its caller.
 */
export interface ResumeTurn {
  readonly kind: 'resume';
  readonly checkpoint: FlowchartCheckpoint;
  readonly answer: unknown;
  readonly options: AgentRunOptions | undefined;
}

/** The turn a wrapper is wrapped around, told apart by `kind`. */
export type AgentTurn = RunTurn | ResumeTurn;

/**
 * The closed set of changes `proceed` accepts, on a `run` turn only.
 *
 * `time` takes the path `run({ time })` takes, so the clock row is the normal
 * one. A field the wrapper names wins; a field it leaves out stays the
 * caller's (`input.time`, else `options.time`).
 */
export interface TurnChanges {
  readonly time?: RunTime;
}

/**
 * Runs the turn. Resolves to nothing: the output, the pause and the checkpoint
 * stay with the library. Rejects with the run's own error when the run fails.
 * When the run completed, paused, failed or was cancelled, it settles only
 * after the run's finalizers have settled inside the wrapper's context, and
 * any recording due by then has been filed. A paused run files none yet: its
 * run-scoped resources stay open and its one recording is filed when the
 * resumed turn ends. When the turn
 * fails in the agent's own work around a run that settled (a typed run that
 * refuses a pause, for example), it rejects first, and those finalizers run
 * after the wrapper returns, outside its context, so the end stays failed.
 * The stored recording covers the turn up to this point: a failure the wrapper
 * raises after `proceed` resolves goes on the live
 * `agentfootprint.agent.around_turn_failed` event only, not into the record.
 * Call it once, while the wrapper is still running.
 */
export type ProceedWithTurn = (changes?: TurnChanges) => Promise<void>;

/**
 * Work that must wrap a whole turn: awaited preparation before it, an
 * `AsyncLocalStorage` held around it, cleanup after it. Declared with
 * `.aroundTurn()` on the builder.
 */
export interface AroundTurn {
  /** Named on every refusal and on `agentfootprint.agent.around_turn_failed`. */
  readonly name: string;
  /** Do the work and call `proceed` once. Its return value is ignored. */
  around(turn: AgentTurn, proceed: ProceedWithTurn): void | Promise<void>;
}
