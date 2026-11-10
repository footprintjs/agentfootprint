import type { AgentRunOptions } from '../runOptions/options.js';

import { type AgentRunValues } from '../../runValues.js';
import {
  type CombinedNarrativeEntry,
  type FlowchartCheckpoint,
  type ObserverDrainResult,
  type RuntimeSnapshot,
} from 'footprintjs';
import type { CachePolicy } from '../../../../cache/types.js';

import { type RunnerPauseOutcome } from '../../../pause.js';
import type { ArtifactStore } from '../../../../artifacts/types.js';
import type { AgentfootprintEvent } from '../../../../events/registry.js';

import type { AnswerAssessment, AssessmentDeclarations } from '../../assessment/types.js';

import { type ChildOutcome } from '../../../terminalVerdict.js';

import { type AgentRunCheckpoint } from '../../../runCheckpoint.js';

import { RunnerBase } from '../../../RunnerBase.js';

import type { AgentInput, AgentOutput, AgentState } from '../../types.js';

import type { AnswerNegatives } from '../../negativeClaims/delivery.js';
import type { AnswerCoverage } from '../../../../semantics/coverage/answer.js';
import { type AnswerValidationReport } from '../../../../answer-validation/index.js';

import type { AgentContext, AgentPublicRunner } from '../contracts.js';
import type { AgentNativeBindings } from './bindings.js';
import { createAgentContext } from '../context.js';
import { initializeAgent } from './initialize.js';

const agentContexts = new WeakMap<AgentPublicRunner, AgentContext>();

/** Private per-runner wiring, read without dispatching an application method.
 * @internal
 */
export function getAgentRuntime(runner: AgentPublicRunner): AgentContext {
  const context = agentContexts.get(runner);
  if (context === undefined) throw new TypeError('Agent runtime has not been initialized.');
  return context;
}

/** Original native runner identity with captured capabilities for its internal owners.
 * @internal
 */
export abstract class AgentRuntimeHost extends RunnerBase<AgentInput, AgentOutput, AgentRunValues> {
  readonly name!: string;
  readonly id!: string;
  readonly appName!: string;
  readonly commentaryTemplates!: Readonly<Record<string, string>>;
  readonly thinkingTemplates!: Readonly<Record<string, string>>;

  constructor(
    ownTurnMethods: Readonly<Record<'run' | 'resume', unknown>>,
    ...args: Parameters<typeof initializeAgent>
  ) {
    super();
    const readSessions = () => this.toolSessionTier;
    const writeSessions = (value: AgentNativeBindings['toolSessionTier']) => {
      this.toolSessionTier = value;
    };
    const native: AgentNativeBindings = {
      dispatcher: this.dispatcher,
      attachedRecorders: this.attachedRecorders,
      get toolSessionTier() {
        return readSessions();
      },
      set toolSessionTier(value) {
        writeSessions(value);
      },
      runExecution: () => this.runExecution(),
      initChart: (builder, execution) => this.initChart(builder, execution),
      noteResumeTakenUp: (checkpoint) => this.noteResumeTakenUp(checkpoint),
      getDispatcher: () => this.getDispatcher(),
      minimalMeta: () => this.minimalMeta(),
      liveSnapshot: () => this.liveSnapshot(),
      emitPauseResume: (checkpoint, input, handedDown) =>
        this.emitPauseResume(checkpoint, input, handedDown),
      prepareRunRedaction: (invocation, handedDown) =>
        this.prepareRunRedaction(invocation, handedDown),
      bindRunServing: (invocation) => this.bindRunServing(invocation),
      detectPause: (invocation, result) => this.detectPause(invocation, result),
      getLastSnapshot: () => super.getLastSnapshot(),
    };
    const context = createAgentContext(this, native, ownTurnMethods);
    agentContexts.set(this, context);
    initializeAgent.call(context, ...args);
  }

  protected override getGroupTranslator():
    | import('../../../translator.js').GroupTranslator
    | undefined {
    return getAgentRuntime(this).getGroupTranslator();
  }
  protected override buildUIGroupMetadata(): import('../../../translator.js').GroupMetadata {
    return getAgentRuntime(this).buildUIGroupMetadata();
  }

  abstract getSystemPromptCachePolicy(): CachePolicy;
  abstract getArtifactStore(): ArtifactStore | undefined;
  abstract ownsEvent(event: AgentfootprintEvent): boolean;
  abstract getLastSnapshot(): RuntimeSnapshot | undefined;
  abstract getLastNarrativeEntries(): readonly CombinedNarrativeEntry[];
  abstract parseOutput<T = unknown>(raw: string): T;
  abstract parseOutputAsync<T = unknown>(raw: string): Promise<T>;
  abstract runTyped<T = unknown>(input: AgentInput | string, options?: AgentRunOptions): Promise<T>;
  abstract run(
    input: AgentInput | string,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  abstract followUp(
    message: string,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  abstract abandonPause(): Promise<
    | { readonly toolName?: string; readonly toolCallId?: string; readonly question?: string }
    | undefined
  >;
  abstract canExplain(): boolean;
  abstract resumeOnError(
    checkpoint: AgentRunCheckpoint | unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  abstract resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  abstract checkpoint(): AgentRunCheckpoint | undefined;
  abstract bindSelfExplain(binding: Parameters<AgentContext['bindSelfExplain']>[0]): void;
  abstract drainObservers(opts?: { timeoutMs?: number }): Promise<ObserverDrainResult>;
  abstract stoppedEarly(): AgentState['stoppedEarly'];
  abstract outputContractUnmet(): AgentState['outputContractUnmet'];
  abstract unsupportedValues(): AgentState['unsupportedValues'];
  abstract findings(): AgentState['findingsLedger'];
  abstract answerNegatives(): AnswerNegatives | undefined;
  abstract answerValidation(): AnswerValidationReport | undefined;
  abstract answerCoverage(): AnswerCoverage | undefined;
  abstract assessment(declarations?: AssessmentDeclarations): Promise<AnswerAssessment | undefined>;
  abstract outcomeOf(sfOutput: unknown): ChildOutcome;
}
