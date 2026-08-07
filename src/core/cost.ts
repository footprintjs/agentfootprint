/**
 * cost — shared cost-accounting helper emitted by LLMCall + Agent.
 *
 * Pattern: Strategy (PricingTable port) + Event emission (typedEmit).
 * Role:    core/ layer. When a runner is configured with a PricingTable,
 *          every LLM response drives a `cost.tick` event carrying per-call
 *          tokens/USD plus cumulative run totals. When a `costBudget` is
 *          also set, the first crossing emits `cost.limit_hit` with
 *          `action: 'warn'` (library never auto-aborts; consumers decide).
 * Emits:   agentfootprint.cost.tick
 *          agentfootprint.cost.limit_hit
 */

import type { PricingTable } from '../adapters/types.js';
import { typedEmit } from '../recorders/core/typedEmit.js';

export interface CostAccountingScope {
  cumTokensInput: number;
  cumTokensOutput: number;
  cumEstimatedUsd: number;
  costBudgetHit: boolean;
}

/**
 * Refuse a `costBudget` with no `pricingTable` to measure it against (8.13.0).
 *
 * The budget is denominated in USD and {@link emitCostTick} returns on its first
 * line when there is no pricing table, so before this refusal the pair emitted
 * NOTHING — no `cost.tick`, and no `cost.limit_hit` however much a run spent. A
 * budget that cannot be crossed is not a lenient budget; it is a guard rail that
 * was never installed, and it looks identical from the outside to one that
 * simply has not been hit yet.
 *
 * Shared by BOTH runners that take the pair. Leaving the sibling class with the
 * same silent no-op would be a governance fix that itself drops half the cases.
 *
 * @param runner the class name for the message — `'Agent'` or `'LLMCall'`.
 */
export function assertCostBudgetHasPricing(
  runner: 'Agent' | 'LLMCall',
  pricingTable: PricingTable | undefined,
  costBudget: number | undefined,
): void {
  if (costBudget === undefined || pricingTable !== undefined) return;
  throw new Error(
    `${runner}: costBudget was set without a pricingTable, so it can never be reached — the ` +
      `budget is USD, and only a pricingTable turns tokens into USD. Nothing is emitted: no ` +
      `cost.tick, and no cost.limit_hit however much the run spends. Pass \`pricingTable\` too ` +
      `— any object with { name, pricePerToken(model, kind) } where kind is 'input' | 'output' ` +
      `| 'cacheRead' | 'cacheWrite' and the number is USD for ONE token. The library ships no ` +
      `table because prices are yours to keep current. Or drop \`costBudget\`.`,
  );
}

type Usage = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
};

/**
 * Emit `cost.tick` for the just-completed LLM response and, if the
 * consumer set a `costBudget`, emit a one-shot `cost.limit_hit` the first
 * time cumulative USD crosses the budget. Does nothing when no
 * `pricingTable` is configured — zero overhead on runs without costing.
 *
 * Scope must carry the running cumulative counters; callers seed them
 * in their Seed stage.
 */
export function emitCostTick(
  scope: CostAccountingScope & { $emit: (name: string, payload?: unknown) => void },
  pricingTable: PricingTable | undefined,
  costBudget: number | undefined,
  model: string,
  usage: Usage,
): void {
  if (!pricingTable) return;

  const usdThisCall =
    pricingTable.pricePerToken(model, 'input') * usage.input +
    pricingTable.pricePerToken(model, 'output') * usage.output +
    (usage.cacheRead !== undefined
      ? pricingTable.pricePerToken(model, 'cacheRead') * usage.cacheRead
      : 0) +
    (usage.cacheWrite !== undefined
      ? pricingTable.pricePerToken(model, 'cacheWrite') * usage.cacheWrite
      : 0);

  scope.cumTokensInput = (scope.cumTokensInput ?? 0) + usage.input;
  scope.cumTokensOutput = (scope.cumTokensOutput ?? 0) + usage.output;
  scope.cumEstimatedUsd = (scope.cumEstimatedUsd ?? 0) + usdThisCall;

  typedEmit(scope, 'agentfootprint.cost.tick', {
    scope: 'iteration',
    tokensInput: usage.input,
    tokensOutput: usage.output,
    estimatedUsd: usdThisCall,
    cumulative: {
      tokensInput: scope.cumTokensInput,
      tokensOutput: scope.cumTokensOutput,
      estimatedUsd: scope.cumEstimatedUsd,
    },
  });

  // First-time crossing of costBudget — emit limit_hit once per run.
  if (costBudget !== undefined && !scope.costBudgetHit && scope.cumEstimatedUsd > costBudget) {
    scope.costBudgetHit = true;
    typedEmit(scope, 'agentfootprint.cost.limit_hit', {
      kind: 'max_cost',
      limit: costBudget,
      actual: scope.cumEstimatedUsd,
      action: 'warn',
    });
  }
}
