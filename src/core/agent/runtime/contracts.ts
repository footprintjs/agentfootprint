import type { AgentConfiguration } from './configuration/types.js';
import type { AgentRunOptions } from './runOptions/options.js';
import type { AgentAroundTurnFailedPayload } from '../../../events/payloads/agent.js';
import type { AgentRunValues } from '../runValues.js';
import type {
  RunnerScopeValues,
  RunnerInvocation,
  RunnerSelection,
} from '../../runnerExecution.js';
import type {
  CombinedNarrativeEntry,
  FlowChart,
  FlowchartCheckpoint,
  ObserverDrainResult,
  RuntimeSnapshot,
  RunSetup,
} from 'footprintjs';
import type { CachePolicy } from '../../../cache/types.js';
import type { RunnerPauseOutcome } from '../../pause.js';
import type { LLMToolSchema } from '../../../provider-contract/types.js';
import type { ArtifactStore } from '../../../artifacts/types.js';
import type { RunContext } from '../../../bridge/eventMeta.js';
import type {
  ToolSessionTier,
  ToolSessionOrigin,
  ToolSessionReport,
} from '../../../tools/toolSessions.js';
import type { AgentfootprintEvent, AgentfootprintEventType } from '../../../events/registry.js';
import type { AnswerAssessment, AssessmentDeclarations } from '../assessment/types.js';
import type { MemoryIdentity } from '../../../memory/identity/types.js';
import type { SelfExplainBinding } from '../../../trace-toolpack/selfExplain.js';
import type { ChildOutcome } from '../../terminalVerdict.js';
import type { AgentRunCheckpoint } from '../../runCheckpoint.js';
import type { TimeAnswerContext } from '../../../tools/inputRequest.js';
import type { ClockDraft, ReadRunTime } from '../../../time/clock.js';
import type { AgentInput, AgentOutput, AgentState } from '../types.js';
import type { AnswerNegatives } from '../negativeClaims/delivery.js';
import type { AnswerCoverage } from '../../../semantics/coverage/answer.js';
import type { AnswerValidationReport } from '../../../answer-validation/index.js';
import type { RequestContext } from '../../../identity/requestContext.js';
import type { Runner } from '../../runner.js';

import type { AgentNativeBindings } from './native/bindings.js';

export interface AgentMethods {
  getSystemPromptCachePolicy(): CachePolicy;
  getArtifactStore(): ArtifactStore | undefined;
  ownsEvent(event: AgentfootprintEvent): boolean;
  getLastSnapshot(): RuntimeSnapshot | undefined;
  getLastNarrativeEntries(): readonly CombinedNarrativeEntry[];
  getGroupTranslator(): import('../../translator.js').GroupTranslator | undefined;
  buildUIGroupMetadata(): import('../../translator.js').GroupMetadata;
  parseOutput<T = unknown>(raw: string): T;
  parseOutputAsync<T = unknown>(raw: string): Promise<T>;
  settleTypedFailure<T>(
    raw: string,
    err: unknown,
    invocation?: RunnerInvocation<AgentRunValues>,
  ): Promise<T>;
  retriesSpent(invocation: RunnerInvocation<AgentRunValues>): number | undefined;
  runTyped<T = unknown>(input: AgentInput | string, options?: AgentRunOptions): Promise<T>;
  typedOutcome<T>(
    invocation: RunnerInvocation<AgentRunValues>,
    out: AgentOutput | RunnerPauseOutcome,
  ): Promise<T>;
  run(
    input: AgentInput | string,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  runOwned(
    invocation: RunnerInvocation<AgentRunValues>,
    input: AgentInput | string,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  runTurn<R>(
    invocation: RunnerInvocation<AgentRunValues>,
    input: AgentInput | string,
    options: AgentRunOptions | undefined,
    leg: (turnInput: AgentInput | string) => Promise<R>,
  ): Promise<R>;
  noteAroundTurnFailed(
    invocation: RunnerInvocation<AgentRunValues>,
    payload: AgentAroundTurnFailedPayload,
  ): void;
  runLeg(
    invocation: RunnerInvocation<AgentRunValues>,
    input: AgentInput | string,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  followUp(message: string, options?: AgentRunOptions): Promise<AgentOutput | RunnerPauseOutcome>;
  abandonPause(): Promise<
    | { readonly toolName?: string; readonly toolCallId?: string; readonly question?: string }
    | undefined
  >;
  canExplain(): boolean;
  resumeOnError(
    checkpoint: AgentRunCheckpoint | unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  identityFor(
    options: AgentRunOptions | undefined,
    cp: AgentRunCheckpoint,
  ): MemoryIdentity | undefined;
  clockDraftFor(time: unknown, runner: string): ClockDraft | undefined;
  seedClockDraft(values: AgentRunValues): ClockDraft;
  passedTimeFor(time: unknown, runner: string): ReadRunTime | undefined;
  resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  resumeOwned(
    invocation: RunnerInvocation<AgentRunValues>,
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  resumeLeg(
    invocation: RunnerInvocation<AgentRunValues>,
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome>;
  checkpoint(): AgentRunCheckpoint | undefined;
  checkpointFor(
    selected: RunnerSelection<AgentRunValues> | undefined,
  ): AgentRunCheckpoint | undefined;
  noteAdmittedRun(invocation: RunnerInvocation<AgentRunValues>): void;
  revisionWithholdsTools(): boolean;
  lastInputRefused(view: import('footprintjs').RunView | undefined): boolean;
  continuityCursorOf(state?: Partial<AgentState>): string | undefined;
  timeAnswerContextOf(state: unknown): TimeAnswerContext | undefined;
  turnNumberOf(state?: Partial<AgentState>): number | undefined;
  conversationOwner(values: AgentRunValues): {
    identity?: MemoryIdentity;
    agentId?: string;
  };
  applyContinuation(
    values: AgentRunValues,
    cp: AgentRunCheckpoint,
    door: string,
    appendsUserTurn: boolean,
  ): void;
  assertNoPendingQuestion(door: string, values: AgentRunValues | undefined): void;
  recordPendingQuestion(values: AgentRunValues, outcome: AgentOutput | RunnerPauseOutcome): void;
  bindSelfExplain(binding: SelfExplainBinding): void;
  toolRunFacts(run: RunnerScopeValues<AgentRunValues>): {
    readonly runContext: RunContext;
    readonly runId: string;
    readonly sessionId?: string;
    readonly identity?: MemoryIdentity;
  };
  toolSessions(): ToolSessionTier;
  emitLateFact(
    type: AgentfootprintEventType,
    payload: Record<string, unknown>,
    runContext: RunContext,
  ): void;
  emitToolSessionReport(report: ToolSessionReport, origin: ToolSessionOrigin): void;
  openSkillIds(): readonly string[];
  readSkillOfferFor():
    | ((args: {
        readonly currentSkillId?: string;
        readonly hiddenSkillIds?: readonly string[];
        readonly menu?: {
          readonly candidates: ReadonlyArray<{ readonly id: string; readonly relevance?: number }>;
          readonly cursorId?: string;
          readonly stay?: boolean;
        };
      }) => LLMToolSchema | undefined)
    | undefined;
  governsSkillVisibility(): boolean;
  hiddenSkillIdsNow(): ((scope: object) => Promise<readonly string[]>) | undefined;
  assertDeliverableRoles(): void;
  prepareAgentRun(
    invocation: RunnerInvocation<AgentRunValues>,
    runOptions?: AgentRunOptions,
    request?: RequestContext,
  ): {
    readonly setup: RunSetup;
    readonly binding: Parameters<RunnerInvocation<AgentRunValues>['execute']>[2];
  };
  beginIntegrityLedger(values: AgentRunValues): void;
  assertIntegrityAlive(invocation: RunnerInvocation<AgentRunValues>): void;
  integrityWorkExisted(invocation: RunnerInvocation<AgentRunValues>): boolean;
  fileIntegrityDisposition(invocation: RunnerInvocation<AgentRunValues>): void;
  emitRunManifest(context: RunContext): void;
  emitSkillGraphDeclared(context: RunContext): void;
  drainObservers(opts?: { timeoutMs?: number }): Promise<ObserverDrainResult>;
  stoppedEarly(): AgentState['stoppedEarly'];
  outputContractUnmet(): AgentState['outputContractUnmet'];
  unsupportedValues(): AgentState['unsupportedValues'];
  findings(): AgentState['findingsLedger'];
  answerNegatives(): AnswerNegatives | undefined;
  answerValidation(): AnswerValidationReport | undefined;
  answerCoverage(): AnswerCoverage | undefined;
  assessment(declarations?: AssessmentDeclarations): Promise<AnswerAssessment | undefined>;
  outcomeOf(sfOutput: unknown): ChildOutcome;
  finalizeResult(
    invocation: RunnerInvocation<AgentRunValues>,
    result: unknown,
  ): AgentOutput | RunnerPauseOutcome;
  buildChart(): FlowChart;
}

export type AgentPublicRunner = Runner<AgentInput, AgentOutput> &
  Pick<
    AgentMethods,
    | 'getSystemPromptCachePolicy'
    | 'getArtifactStore'
    | 'ownsEvent'
    | 'getLastSnapshot'
    | 'getLastNarrativeEntries'
    | 'parseOutput'
    | 'parseOutputAsync'
    | 'runTyped'
    | 'run'
    | 'followUp'
    | 'abandonPause'
    | 'canExplain'
    | 'resumeOnError'
    | 'resume'
    | 'checkpoint'
    | 'bindSelfExplain'
    | 'drainObservers'
    | 'stoppedEarly'
    | 'outputContractUnmet'
    | 'unsupportedValues'
    | 'findings'
    | 'answerNegatives'
    | 'answerValidation'
    | 'answerCoverage'
    | 'assessment'
    | 'outcomeOf'
  > & {
    name: string;
    id: string;
    appName: string;
    commentaryTemplates: Readonly<Record<string, string>>;
    thinkingTemplates: Readonly<Record<string, string>>;
  };

/** Private per-agent declarations; run identities remain in the native component bank. */
export interface AgentContext extends AgentMethods {
  readonly runner: AgentPublicRunner;
  readonly native: AgentNativeBindings;
  readonly configuration: AgentConfiguration;
  readonly ownTurnMethods: Readonly<Record<'run' | 'resume', unknown>>;
  inputsLayerArmed: boolean;
  resultsLayerArmed: boolean;
  ontologyTools?: Readonly<Record<string, readonly string[]>>;
  integrityDanglingPresent: boolean;
  integrityColumnsPresent: boolean;
  selfExplainBinding?: SelfExplainBinding;
}
