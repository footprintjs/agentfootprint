import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../provider-contract/types.js';
import type { ToolChoiceEntry } from './toolChoice/types.js';
import type { AgentState } from './types.js';
import type { RequestReplayValue } from './requestTurn/state.js';
import { writeRequestReplay } from './requestTurn/native.js';
import { seedProviderIntervention } from '../providerIntervention.js';

/**
 * Inner seed for the `sf-llm-call` subflow. Initialises the per-turn
 * working keys (the ones the OUTER seed set on the flat chart) and
 * copies the cross-iteration accumulators from their read-only `prior*`
 * inputs into the writable working keys.
 *
 * Why the `prior*` indirection: `inputMapper` values are frozen inside
 * the subflow (any `scope.set` on them throws). callLLM does
 * `scope.totalInputTokens += usage` — so `totalInputTokens` must be a
 * writable working key, seeded here from the frozen `priorTotalInputTokens`.
 */
export function dynamicTurnSeed(scope: TypedScope<AgentState>): void {
  const args = scope.$getArgs<{
    priorTotalInputTokens?: number;
    priorTotalOutputTokens?: number;
    priorTotalCacheReadTokens?: number;
    priorCumTokensInput?: number;
    priorCumTokensOutput?: number;
    priorCumEstimatedUsd?: number;
    priorCostBudgetHit?: boolean;
    priorSkillHistory?: readonly (string | undefined)[];
    priorHistory?: readonly LLMMessage[];
    priorDeliveredMessageKeys?: readonly string[];
    priorEvidenceRecoveryUsed?: boolean;
    priorToolChoices?: readonly ToolChoiceEntry[];
    priorLatestReplay?: AgentState['llmLatestReplay'];
    priorLatestStopReason?: AgentState['llmLatestStopReason'];
    priorRequestReplay?: RequestReplayValue;
  }>();
  seedProviderIntervention(scope, args);

  // Cross-iteration accumulators — seed working keys from prior totals
  // so they continue to accumulate across loop re-entries.
  scope.totalInputTokens = args.priorTotalInputTokens ?? 0;
  scope.totalOutputTokens = args.priorTotalOutputTokens ?? 0;
  // Cache reads (9.110.0) — value-conditional both ways: seeded only when a
  // provider has reported one, so a run on a provider that reports none
  // crosses no new key.
  if (args.priorTotalCacheReadTokens !== undefined) {
    scope.totalCacheReadTokens = args.priorTotalCacheReadTokens;
  }
  scope.cumTokensInput = args.priorCumTokensInput ?? 0;
  scope.cumTokensOutput = args.priorCumTokensOutput ?? 0;
  scope.cumEstimatedUsd = args.priorCumEstimatedUsd ?? 0;
  scope.costBudgetHit = args.priorCostBudgetHit ?? false;
  scope.skillHistory = args.priorSkillHistory ?? [];

  // The WINDOW, as a writable working key (7.21). It used to arrive as the
  // read-only `history` input, which was fine while nothing inside the
  // subflow changed it — the Deliver stage does. Seeding it here from
  // `priorHistory` (and bubbling it out at the boundary) is what makes the
  // one-past law hold in the grouped shape too: what this iteration sends is
  // what the next iteration's window stage sees. The delivery ledger takes
  // the same trip so a delivered message is not re-delivered next turn.
  scope.history = args.priorHistory ?? [];
  scope.deliveredMessageKeys = args.priorDeliveredMessageKeys ?? [];
  if (args.priorEvidenceRecoveryUsed !== undefined) {
    scope.evidenceRecoveryUsed = args.priorEvidenceRecoveryUsed;
  }
  // The classifier's rows (9.105.0), the `history` trip: the Tools branch
  // inside this boundary reads them, the call-llm stage appends to them, and
  // the boundary bubbles them out — so they arrive under an alias and become
  // the writable working key here. Value-conditional: an unarmed agent, and
  // an armed one on its first call, seeds no key.
  if (args.priorToolChoices !== undefined) scope.toolChoices = args.priorToolChoices;
  // Carry presence across the fresh inner scope so a reply with no replay
  // evidence can explicitly clear the outer turn's former evidence.
  if (args.priorLatestReplay !== undefined) scope.llmLatestReplay = args.priorLatestReplay;
  if (args.priorRequestReplay !== undefined) writeRequestReplay(scope, args.priorRequestReplay);
  // A normal reply can explicitly clear the outer scope’s preceding cutoff.
  if (args.priorLatestStopReason !== undefined)
    scope.llmLatestStopReason = args.priorLatestStopReason;

  // Per-iteration working keys — fresh each turn (slots + cache + callLLM
  // populate these inside the subflow; nothing outside reads the
  // injection arrays, so they stay subflow-internal).
  scope.activeInjections = [];
  scope.systemPromptInjections = [];
  scope.messagesInjections = [];
  scope.toolsInjections = [];
  scope.cacheMarkers = [];
  scope.llmLatestContent = '';
  scope.llmLatestToolCalls = [];
  scope.thinkingBlocks = [];
}
