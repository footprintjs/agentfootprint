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
import type { AgentfootprintEvent } from '../../events/registry.js';
import type { Unsubscribe } from '../../events/dispatcher.js';
import { createRunnerSnapshotReader } from '../runnerSnapshot.js';
import { MAX_COMPLETED_TURN_EVENTS } from './turnEvidence/admitCompletedTurn.js';
import type { TurnEvidenceSource } from './turnEvidence/types.js';

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
  observe(listener: (event: AgentfootprintEvent) => void): Unsubscribe;
}
/** Host delivery uses this invocation's result and view, captured before its native lease ends. */
export function hostedTurns(
  execution: RunnerExecution<AgentRunValues>,
  ports: HostTurnPorts,
): NonNullable<RunnerLive['turn']> {
  let readSnapshot: ReturnType<typeof createRunnerSnapshotReader> | undefined;
  const retain = (
    selected: RunnerSelection<AgentRunValues>,
    events: AgentfootprintEvent[],
  ): TurnEvidenceSource | undefined => {
    try {
      const snapshot = (readSnapshot ??= createRunnerSnapshotReader())(selected, {
        contextShapes: false,
      });
      return snapshot === undefined ? undefined : { snapshot, events: Object.freeze(events) };
    } catch {
      // An optional evidence reader must not change the hosted answer.
      return undefined;
    }
  };
  const capture = (
    body: (run: RunnerInvocation<AgentRunValues>) => Promise<AgentOutput | RunnerPauseOutcome>,
    bind?: BindHostedInvocation,
    captureEvidence?: boolean,
  ): Promise<HostedTurn> =>
    execution
      .withRun(async (run) => {
        const recorder = bind?.({
          view: run.view,
          runId: () => run.run.origin?.runId,
          // The value `conversationOwner` stamps on the finished checkpoint.
          identity: () => run.value.identity,
        });
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
        const events: AgentfootprintEvent[] | undefined = captureEvidence ? [] : undefined;
        const off =
          events === undefined
            ? undefined
            : ports.observe((event) => {
                const origin = run.run.origin;
                if (
                  origin !== undefined &&
                  event.meta?.runId === origin.runId &&
                  events.length <= MAX_COMPLETED_TURN_EVENTS
                )
                  events.push(event);
              });
        try {
          const output = await body(owned);
          const selected =
            run.run.origin === undefined
              ? undefined
              : { value: run.value, context: run.context(), view: run.view };
          const paused = isPaused(output);
          const evidence =
            events !== undefined && selected !== undefined && !paused
              ? retain(selected, events)
              : undefined;
          return {
            values: run.value,
            completed: {
              output,
              conversation: selected === undefined ? undefined : ports.checkpoint(selected),
              ownership: paused ? capturePauseOwnership(run.value, output) : undefined,
              ...(evidence !== undefined && { evidence }),
            },
          };
        } finally {
          off?.();
        }
      })
      .then(({ values, completed }) => {
        // Automatic filing runs in the lease's finalizers. Read its receipt
        // only after those finish, from the exact bank captured above.
        const { recording } = values;
        return recording === undefined ? completed : { ...completed, recording };
      });
  return {
    replaced: ports.replaced,
    run: (input, options, bind, captureEvidence) =>
      capture((run) => ports.run(run, input, options), bind, captureEvidence),
    resume: (checkpoint, input, options, bind, captureEvidence) => {
      ports.prepareResume(checkpoint);
      return capture(
        (run) =>
          preservePendingQuestion(
            run.previous?.value,
            () => run.value.resources?.answer.consumed === true,
            () => ports.resume(run, checkpoint, input, options),
          ),
        bind,
        captureEvidence,
      );
    },
  };
}
