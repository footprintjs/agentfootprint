import type { RuntimeSnapshot } from 'footprintjs';
import type {
  CombinedRecorder,
  FlowChart,
  FlowChartExecutor,
  FlowChartExecutorOptions,
  FlowchartCheckpoint,
  RedactionPolicy,
} from 'footprintjs';
import type { EventDispatcher } from '../../../../events/dispatcher.js';
import type { RunRedaction } from '../../../../redaction/runRedaction.js';
import type {
  RunnerExecution,
  RunnerInvocation,
  RunnerComponentInstaller,
} from '../../../runnerExecution.js';
import type { RunnerPauseOutcome } from '../../../pause.js';
import type { EventMeta } from '../../../../events/types.js';
import type { ToolSessionTier } from '../../../../tools/toolSessions.js';
import type { AgentRunValues } from '../../runValues.js';

export interface AgentNativeBindings {
  readonly dispatcher: EventDispatcher;
  readonly attachedRecorders: CombinedRecorder[];
  toolSessionTier: ToolSessionTier | undefined;
  runExecution(): RunnerExecution<AgentRunValues>;
  initChart(
    builder: () => FlowChart,
    execution: {
      readonly runnerId: string;
      readonly compositionPath: readonly string[];
      readonly initialize: () => AgentRunValues;
      readonly options?: FlowChartExecutorOptions;
      readonly componentSetup?: RunnerComponentInstaller<AgentRunValues>;
    },
  ): void;
  noteResumeTakenUp(checkpoint: FlowchartCheckpoint): void;
  getDispatcher(): EventDispatcher;
  minimalMeta(): EventMeta;
  liveSnapshot(): ReturnType<FlowChartExecutor['getSnapshot']> | undefined;
  emitPauseResume(
    checkpoint: FlowchartCheckpoint,
    input: unknown,
    handedDown?: RedactionPolicy,
  ): RedactionPolicy | undefined;
  prepareRunRedaction(
    invocation: RunnerInvocation<AgentRunValues>,
    handedDown?: RedactionPolicy,
  ): RunRedaction;
  bindRunServing(invocation: RunnerInvocation<AgentRunValues>): void;
  detectPause(
    invocation: RunnerInvocation<AgentRunValues>,
    result: unknown,
  ): RunnerPauseOutcome | undefined;
  getLastSnapshot(): RuntimeSnapshot | undefined;
}
