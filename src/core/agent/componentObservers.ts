import type { ComponentRun, InlineComponentRecorder, NativeMappingBinding } from 'footprintjs';
import { causalEvidenceRecorder, type RunEvidence } from '../../memory/causal/evidenceRecorder.js';
import { compactionMeter } from '../../recorders/core/CompactionMeter.js';
import type { LLMMessage } from '../../provider-contract/types.js';
import type { RunnerEntry } from '../runnerExecution.js';
import type { RunCheckpointTracker } from '../runCheckpoint.js';
import type { AgentRunValues } from './runValues.js';

/** One native component leg's working observers; never an Agent-wide listener. */
export function agentComponentObservers(
  component: ComponentRun,
  values: AgentRunValues,
  entry: RunnerEntry | undefined,
  configured: { readonly causal: boolean; readonly window: boolean },
): { readonly recorder: InlineComponentRecorder; emit(type: string, payload: unknown): void } {
  const causal = configured.causal
    ? causalEvidenceRecorder({
        coverage: {
          scope: 'component-execution-leg',
          runId: component.origin.runId,
          entry: entry ?? { kind: 'mounted', nativeEntry: 'unavailable' },
          priorLegs: 'not-carried',
        },
      })
    : undefined;
  const meter = configured.window ? compactionMeter() : undefined;
  values.causalEvidence = causal;
  values.compactionMeter = meter;

  const unmeasurable = (): void => {
    meter?.clear();
    meter?.noteLlmEnd(undefined);
  };
  return {
    recorder: {
      id: 'af-component-observers',
      ...(causal && {
        onDecision: (event) => causal.onDecision(event),
        onSelected: (event) => causal.onSelected(event),
      }),
      ...(meter && {
        onWrite: (event) => {
          try {
            meter.onWrite(event);
          } catch {
            unmeasurable();
          }
        },
      }),
    },
    emit(type, payload) {
      causal?.onEmit({ name: type, payload });
      if (type === 'agentfootprint.stream.llm_end') {
        try {
          meter?.noteLlmEnd(payload);
        } catch {
          unmeasurable();
        }
      }
      if (values.checkpointTracker !== undefined && !values.checkpointObservationFailed) {
        try {
          observeCheckpoint(values.checkpointTracker, type, payload);
        } catch {
          values.checkpointObservationFailed = true;
        }
      }
    },
  };
}

/** Collect ONLY the aggregate resolved from the native memory writer's parent binding. */
export function componentEvidence(
  values: AgentRunValues,
  binding: NativeMappingBinding,
): RunEvidence {
  const evidence = values.causalEvidence?.collect() ?? {
    availability: 'unavailable' as const,
    reason: 'not-configured' as const,
  };
  if (evidence.availability === 'unavailable') return evidence;
  const origin = binding.origin;
  const coverage = {
    ...evidence.coverage,
    source: {
      kind: origin.kind,
      runId: origin.runId,
      startedAtMs: origin.startedAtMs,
      runtimeStageId: origin.runtimeStageId,
      ...(origin.subflowPath !== undefined && { subflowPath: origin.subflowPath }),
      ...(origin.parentRuntimeStageId !== undefined && {
        parentRuntimeStageId: origin.parentRuntimeStageId,
      }),
    },
  };
  return { ...evidence, coverage };
}

/** A checkpoint is working replay data, never a served record. */
function observeCheckpoint(tracker: RunCheckpointTracker, type: string, payload: unknown): void {
  switch (type) {
    case 'agentfootprint.agent.iteration_start': {
      const p = payload as { iterIndex?: number } | undefined;
      if (typeof p?.iterIndex === 'number') tracker.inFlightIteration = p.iterIndex;
      return;
    }
    case 'agentfootprint.stream.llm_start':
      tracker.inFlightPhase = { phase: 'llm', stage: 'call-llm' };
      return;
    case 'agentfootprint.stream.llm_end':
      tracker.inFlightPhase = undefined;
      return;
    case 'agentfootprint.stream.tool_start': {
      const p = payload as { toolName?: string; notDispatched?: unknown } | undefined;
      if (p?.notDispatched !== undefined) return;
      tracker.inFlightPhase = {
        phase: 'tool',
        stage: typeof p?.toolName === 'string' ? p.toolName : 'tool',
      };
      return;
    }
    case 'agentfootprint.stream.tool_end': {
      const p = payload as { notDispatched?: unknown } | undefined;
      if (p?.notDispatched !== undefined) return;
      tracker.inFlightPhase = undefined;
      return;
    }
    case 'agentfootprint.agent.iteration_end': {
      const p = payload as { iterIndex?: number; history?: ReadonlyArray<unknown> } | undefined;
      if (typeof p?.iterIndex === 'number') tracker.lastCompletedIteration = p.iterIndex;
      if (Array.isArray(p?.history)) tracker.history = p.history as readonly LLMMessage[];
      tracker.inFlightIteration = undefined;
      tracker.inFlightPhase = undefined;
      return;
    }
  }
}
