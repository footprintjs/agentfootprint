import type { AgentRunOptions } from '../Agent.js';
import type { AgentInput, AgentOutput } from './types.js';
import type { AgentRunValues } from './runValues.js';
import type { RunnerExecution, RunnerInvocation, RunnerSelection } from '../runnerExecution.js';
import { isPaused, type RunnerPauseOutcome } from '../pause.js';
import type { HostedTurn, RunnerLive } from '../runnerLive.js';
import type { AgentRunCheckpoint } from '../runCheckpoint.js';
import { capturePauseOwnership, preservePendingQuestion } from './pauseOwnership.js';
import type { FlowchartCheckpoint } from 'footprintjs';

interface HostTurnPorts {
  run(
    run: RunnerInvocation<AgentRunValues>,
    input: AgentInput | string,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  resume(
    run: RunnerInvocation<AgentRunValues>,
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  prepareResume(checkpoint: FlowchartCheckpoint): void;
  checkpoint(run: RunnerSelection<AgentRunValues>): AgentRunCheckpoint | undefined;
}
/** Host delivery uses this invocation's result and view, captured before its native lease ends. */
export function hostedTurns(
  execution: RunnerExecution<AgentRunValues>,
  ports: HostTurnPorts,
): NonNullable<RunnerLive['turn']> {
  const capture = (
    body: (run: RunnerInvocation<AgentRunValues>) => Promise<AgentOutput | RunnerPauseOutcome>,
  ): Promise<HostedTurn> =>
    execution.withRun(async (run) => {
      const output = await body(run);
      return {
        output,
        conversation:
          run.run.origin === undefined
            ? undefined
            : ports.checkpoint({ value: run.value, context: run.context(), view: run.view }),
        ownership: isPaused(output) ? capturePauseOwnership(run.value, output) : undefined,
      };
    });
  return {
    run: (input, options) => capture((run) => ports.run(run, input, options)),
    resume: (checkpoint, input, options) => {
      ports.prepareResume(checkpoint);
      return capture((run) =>
        preservePendingQuestion(
          run.previous?.value,
          () => run.value.resources?.answer.consumed === true,
          () => ports.resume(run, checkpoint, input, options),
        ),
      );
    },
  };
}
