import type { AgentRunOptions } from '../Agent.js';
import type { AgentInput, AgentOutput } from './types.js';
import type { AgentRunValues } from './runValues.js';
import type { RunnerExecution, RunnerInvocation, RunnerSelection } from '../runnerExecution.js';
import { isPaused, type RunnerPauseOutcome } from '../pause.js';
import type { BindHostedInvocation, HostedTurn, RunnerLive } from '../runnerLive.js';
import type { AgentRunCheckpoint } from '../runCheckpoint.js';
import { capturePauseOwnership, preservePendingQuestion } from './pauseOwnership.js';
import type { FlowchartCheckpoint } from 'footprintjs';
import type { TurnMethod } from './aroundTurn/guards.js';

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
  replaced(): readonly TurnMethod[];
}
/** Host delivery uses this invocation's result and view, captured before its native lease ends. */
export function hostedTurns(
  execution: RunnerExecution<AgentRunValues>,
  ports: HostTurnPorts,
): NonNullable<RunnerLive['turn']> {
  const capture = (
    body: (run: RunnerInvocation<AgentRunValues>) => Promise<AgentOutput | RunnerPauseOutcome>,
    bind?: BindHostedInvocation,
  ): Promise<HostedTurn> =>
    execution.withRun(async (run) => {
      const recorder = bind?.({ view: run.view, runId: () => run.run.origin?.runId });
      const owned =
        recorder === undefined
          ? run
          : ({
              ...run,
              get previous() {
                return run.previous;
              },
              execute: (entry, setup, binding) =>
                run.execute(
                  entry,
                  {
                    ...setup,
                    attachments: [...(setup?.attachments ?? []), { recorder }],
                  },
                  binding,
                ),
            } satisfies RunnerInvocation<AgentRunValues>);
      const output = await body(owned);
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
    replaced: ports.replaced,
    run: (input, options, bind) => capture((run) => ports.run(run, input, options), bind),
    resume: (checkpoint, input, options, bind) => {
      ports.prepareResume(checkpoint);
      return capture(
        (run) =>
          preservePendingQuestion(
            run.previous?.value,
            () => run.value.resources?.answer.consumed === true,
            () => ports.resume(run, checkpoint, input, options),
          ),
        bind,
      );
    },
  };
}
