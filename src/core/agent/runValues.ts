import type { ComponentResources } from './componentResources.js';
import type { RunnerPauseOutcome } from '../pause.js';
import type { CausalEvidenceRecorderHandle } from '../../memory/causal/evidenceRecorder.js';
import type { CompactionMeterHandle } from '../../recorders/core/CompactionMeter.js';
import type { RequestContext } from '../../identity/requestContext.js';
import type { MemoryIdentity } from '../../memory/identity/types.js';
import type { DispositionLedger } from '../../integrity/disposition/ledger.js';
import type { RunCheckpointTracker } from '../runCheckpoint.js';
import type { ClockDraft, ReadRunTime } from '../../time/clock.js';
import type { AnsweredAsk } from '../../tools/inputRequest.js';
import type { AgentRunCheckpoint, EvidenceRecoveryCheckpoint } from '../runCheckpoint.js';
import type { FindingsLedger } from './findings/types.js';
import type { FoldedSpan } from './window/types.js';
import type { buildSeedStage, PendingResumeHistory } from './stages/seed.js';
import { createReceiptDigests, type ReceiptDigests } from './receipt/receiptDigests.js';
import { createEvictedTurnsHandle, type EvictedTurnsHandle } from './window/evictedTurns.js';
import type { buildCallLLMStage } from './stages/callLLM.js';
import type { buildWindowStage } from './stages/window.js';
import type { RunnerCoreValues } from '../RunnerBase.js';
import type { ProviderToolCache, ServedToolParties } from '../slots/buildToolsSlot.js';
import type { buildToolCallsHandler } from './stages/toolCalls/index.js';
import type { buildRouteDeciderStage } from './stages/route.js';
import type { SourceEvidenceIndex } from '../../artifacts/sourceEvidence/types.js';
import type { HostedRecording } from '../runnerLive.js';
import type { SourceConsultation } from './honesty/sourceConsultation.js';
import type { ContextBaselineHolder } from './contextBinding/check.js';

/** Private domain values in the native component bank; never chart state or a run owner. */
export interface AgentRunValues extends RunnerCoreValues {
  identity?: MemoryIdentity;
  request?: RequestContext;
  answer?: string;
  recording?: HostedRecording;
  checkpointTracker?: RunCheckpointTracker;
  checkpointObservationFailed?: true;
  causalEvidence?: CausalEvidenceRecorderHandle;
  compactionMeter?: CompactionMeterHandle;
  resources?: ComponentResources;
  servingConversation?: string;
  hostTurn?: import('./hostEnd/entry.js').HostDecision & { readonly hasInput: boolean };
  hostAdmission?: import('./hostEnd/delivery.js').HostAdmission;
  hostSettlement?: import('../../provider-contract/types.js').LLMMessage;
  hadAdmitted: boolean;
  modelResponseCommitted: boolean;
  pauseOutcome?: RunnerPauseOutcome;
  pendingQuestion?: {
    readonly toolName?: string;
    readonly toolCallId?: string;
    readonly question?: string;
  };
  readonly integrityLedger: { current: DispositionLedger | undefined; readonly answerLayer?: true };
  clockDraft?: ClockDraft;
  resumePassedTime?: ReadRunTime;
  answeredAsk?: AnsweredAsk;
  pendingResumeHistory?: PendingResumeHistory;
  pendingResumeSourceEvidence?: SourceEvidenceIndex;
  pendingEvidenceRecovery?: EvidenceRecoveryCheckpoint;
  pendingSourceDeclarationCorrection?: AgentRunCheckpoint['sourceDeclarationCorrection'];
  pendingResumeFolded?: readonly FoldedSpan[];
  pendingResumeFindingsLedger?: FindingsLedger;
  pendingResumeSkillCursor?: string;
  readonly consentOutstanding: Map<
    string,
    {
      readonly service: string;
      readonly authorizationUrl: string;
      readonly sessionId: string;
      readonly tool: string;
      readonly iteration: number;
    }
  >;
  seed?: ReturnType<typeof buildSeedStage>;
  readonly providerToolCache: ProviderToolCache;
  readonly servedTools: ServedToolParties;
  /** The request behind this run's newest signed response (`contextBinding/check.ts`). */
  readonly contextBaseline: ContextBaselineHolder;
  sourceConsultation?: SourceConsultation;
  readonly receiptDigests: ReceiptDigests;
  readonly evictedTurnsHandle?: EvictedTurnsHandle;
  callLLM?: ReturnType<typeof buildCallLLMStage>;
  window?: ReturnType<typeof buildWindowStage>;
  toolCalls?: ReturnType<typeof buildToolCallsHandler>;
  route?: ReturnType<typeof buildRouteDeciderStage>;
}

export function createAgentRunValues(options: {
  readonly window: boolean;
  readonly answerLayer: boolean;
  readonly sourceNotConsulted?: boolean;
}): AgentRunValues {
  return {
    hadAdmitted: false,
    modelResponseCommitted: false,
    integrityLedger: { current: undefined, ...(options.answerLayer && { answerLayer: true }) },
    consentOutstanding: new Map(),
    providerToolCache: { current: [] },
    servedTools: {
      current: new Map(),
      lastServed: new Map(),
      ...(options.sourceNotConsulted === true && { currentImplementations: new Map() }),
    },
    receiptDigests: createReceiptDigests(),
    contextBaseline: {},
    ...(options.window && { evictedTurnsHandle: createEvictedTurnsHandle() }),
  };
}
