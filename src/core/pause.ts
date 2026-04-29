/**
 * pause — runner-level pause/resume primitives.
 *
 * Pattern: Control-flow exception (PauseRequest) + typed outcome (RunnerPauseOutcome).
 * Role:    core/ layer. Bridges footprintjs.s pause signal into the agentfootprint
 *          Runner contract: tools call `pauseHere(data)` to raise a pause
 *          intent; runners detect the paused executor result and return a
 *          `RunnerPauseOutcome` instead of `TOut`. Consumers call
 *          `runner.resume(checkpoint, input)` to continue.
 * Emits:   N/A (types + helpers only). Event emission happens in RunnerBase.
 *
 * Why a control-flow "throw": tool.execute(args, ctx) doesn't receive the
 * typed scope, so it cannot call `scope.$pause()` directly. A thrown
 * `PauseRequest` is caught inside the Agent's tool-call stage, which then
 * forwards the pause into the flowchart via `scope.$pause()`. This keeps
 * the tool API clean (tools are pure-ish) while still supporting pause.
 */

import type { FlowchartCheckpoint } from 'footprintjs';

/**
 * Outcome returned by `runner.run()` / `runner.resume()` when execution
 * has paused mid-flow. The shape mirrors footprintjs's `PausedResult` but
 * surfaces `pauseData` as a first-class field for consumers who don't
 * want to reach into the checkpoint.
 */
export interface RunnerPauseOutcome {
  readonly paused: true;
  /** Serializable checkpoint — store anywhere (Redis, Postgres, localStorage). */
  readonly checkpoint: FlowchartCheckpoint;
  /** Data passed to `scope.$pause()` / `pauseHere()`. Consumer-typed. */
  readonly pauseData: unknown;
}

/** Type guard — discriminates `RunnerPauseOutcome` from a normal `TOut`. */
export function isPaused<T>(result: T | RunnerPauseOutcome): result is RunnerPauseOutcome {
  return (
    typeof result === 'object' && result !== null && (result as RunnerPauseOutcome).paused === true
  );
}

/**
 * Control-flow error raised by `pauseHere()` inside a tool's `execute()`.
 * Caught by the Agent's tool-call stage, which forwards to `scope.$pause()`.
 * Never propagates to the consumer.
 */
export class PauseRequest extends Error {
  readonly data: unknown;
  constructor(data: unknown) {
    super('PauseRequest');
    this.name = 'PauseRequest';
    this.data = data;
    // Not a real error — stack has no diagnostic value for consumers.
    this.stack = '';
  }
}

/**
 * Called from inside a tool's `execute()` to request a pause. Throws a
 * `PauseRequest` that the Agent catches and forwards to the flowchart.
 *
 * @example
 *   const approveTool: Tool<{ action: string }, string> = {
 *     schema: { name: 'approve', description: 'Ask human', inputSchema: {...} },
 *     execute: async (args) => {
 *       pauseHere({ question: `Approve ${args.action}?`, risk: 'high' });
 *       return ''; // unreachable — pauseHere always throws
 *     },
 *   };
 */
export function pauseHere(data: unknown): never {
  throw new PauseRequest(data);
}

/** Type guard for a thrown `PauseRequest`. */
export function isPauseRequest(err: unknown): err is PauseRequest {
  return (
    err instanceof PauseRequest ||
    (err instanceof Error &&
      err.name === 'PauseRequest' &&
      Object.prototype.hasOwnProperty.call(err, 'data'))
  );
}

/**
 * Ergonomic alias for `pauseHere(data)` — the human-in-the-loop name.
 *
 * `pauseHere` describes the mechanism (control-flow throw); `askHuman`
 * describes the intent (ask a person to decide). Both work identically.
 *
 * @example
 *   const approveRefund: Tool<{ amount: number }, string> = {
 *     schema: { name: 'approve_refund', description: '...', inputSchema: {...} },
 *     execute: async ({ amount }) => {
 *       if (amount > 1000) askHuman({ question: `Approve $${amount}?` });
 *       return 'auto-approved';
 *     },
 *   };
 */
export const askHuman = pauseHere;
