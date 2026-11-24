import type { AgentInput } from '../types.js';
import type { AgentRunOptions } from '../runtime/runOptions/options.js';
import type { AgentContext } from '../runtime/contracts.js';

export interface HostDecision {
  readonly reply: string;
  readonly reason: 'host-cap';
}

export type HostTurnInput = Omit<AgentInput, 'message'> & {
  readonly message?: string;
  readonly options?: AgentRunOptions;
};

/** Admit the candidate to the existing exclusive run lease. Only a real input
 * can enter a wrapper that transforms user messages. */
export function endTurn(
  ctx: AgentContext,
  decision: HostDecision,
  input: HostTurnInput = {},
): Promise<string> {
  return ctx.native.runExecution().withRun(async (run) => {
    const { reply, reason } = decision;
    if (typeof reply !== 'string' || reason !== 'host-cap')
      throw new TypeError('Invalid host turn decision');
    const { message, options, ...rest } = input;
    if (message === undefined && ctx.configuration.aroundTurnPort !== undefined)
      throw new TypeError('A host turn with aroundTurn requires an inbound message');
    ctx.assertNoPendingQuestion('Agent.endTurn', run.previous?.value);
    run.value.hostTurn = { reply, reason, hasInput: message !== undefined };
    try {
      const result =
        message === undefined
          ? await ctx.runLeg(run, { ...rest, message: '' }, options)
          : await ctx.runOwned(run, { ...rest, message }, options);
      if (typeof result !== 'string') throw new Error('A host-ended turn cannot settle a pause');
      return result;
    } finally {
      // Dispose even when native admission, policy or a wrapper throws.
      run.value.hostTurn = undefined;
    }
  });
}
