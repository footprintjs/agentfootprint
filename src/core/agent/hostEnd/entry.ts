import type { AgentInput } from '../types.js';
import type { AgentRunOptions } from '../runtime/runOptions/options.js';
import type { AgentContext } from '../runtime/contracts.js';

export interface HostDecision {
  readonly reply: string;
  readonly reason: 'host-cap';
}

export type HostTurnInput = Omit<AgentInput, 'message'> & {
  readonly message?: string;
  readonly options?: Omit<AgentRunOptions, 'input'>;
};

/** Admit the candidate to the existing exclusive run lease. Only a real input
 * can enter a wrapper that transforms user messages. */
export function endTurn(
  this: Pick<
    AgentContext,
    'native' | 'configuration' | 'assertNoPendingQuestion' | 'runLeg' | 'runOwned'
  >,
  decision: HostDecision,
  input: HostTurnInput = {},
): Promise<string> {
  if (!this.configuration.hostEndedTurns)
    return Promise.reject(
      new TypeError('Agent.endTurn requires hostEndedTurns: true at construction'),
    );
  return this.native.runExecution().withRun(async (run) => {
    const { reply, reason } = decision;
    if (typeof reply !== 'string' || reason !== 'host-cap')
      throw new TypeError('Invalid host turn decision');
    const { message, options, ...rest } = input;
    if (options && 'input' in options)
      throw new TypeError(
        'Pass the inbound message to endTurn directly. Run options cannot supply input.',
      );
    if (message === undefined && this.configuration.aroundTurnPort !== undefined)
      throw new TypeError('A host turn with aroundTurn requires an inbound message');
    this.assertNoPendingQuestion('Agent.endTurn', run.previous?.value);
    run.value.hostTurn = { reply, reason, hasInput: message !== undefined };
    try {
      const result =
        message === undefined
          ? await this.runLeg(run, { ...rest, message: '' }, options)
          : await this.runOwned(run, { ...rest, message }, options);
      if (typeof result !== 'string') throw new Error('A host-ended turn cannot settle a pause');
      return result;
    } finally {
      // Dispose even when native admission, policy or a wrapper throws.
      run.value.hostTurn = undefined;
    }
  });
}
