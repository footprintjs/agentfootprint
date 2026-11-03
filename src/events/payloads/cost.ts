// cost.* (2)
export interface CostTickPayload {
  readonly scope: 'iteration' | 'turn' | 'run';
  /**
   * The model this money was spent on — the one `pricingTable.pricePerToken`
   * was asked about.
   *
   * Always present: a tick exists because a priced call happened, and a call
   * has a model. Without it the event said what was spent and not on what, so
   * a run that switched models mid-loop (a `'retry-other'` failover, a
   * summarizer on a cheaper model) produced a bill nothing could break down.
   */
  readonly model: string;
  /**
   * The provider that billed it, by `LLMProvider.name` — the other half of
   * attribution, since one model name can be served by several providers
   * (Bedrock and Anthropic both answer to a Claude model id, at different
   * prices).
   *
   * Optional for ONE honest reason: a window/compaction strategy reports its
   * summarizer spend through `WindowStrategyResult.spend`, and the provider is
   * read from that strategy's `billing` declaration, which the seam leaves
   * optional. Every shipped strategy declares it. Absent therefore means "the
   * strategy that billed this did not say", never "the agent's provider".
   */
  readonly provider?: string;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly estimatedUsd: number;
  readonly cumulative: {
    readonly tokensInput: number;
    readonly tokensOutput: number;
    readonly estimatedUsd: number;
  };
}

export interface CostLimitHitPayload {
  readonly kind: 'max_tokens' | 'max_cost' | 'max_iterations' | 'max_wallclock';
  readonly limit: number;
  readonly actual: number;
  readonly action: 'abort' | 'warn' | 'degrade';
}
