export interface ThinkingBudgetPort {
  thinkingBudgetValue?: number;
}

export function setThinkingBudget(
  self: ThinkingBudgetPort,
  opts: { budget: number },
  original: object,
): object {
  if (self.thinkingBudgetValue !== undefined) {
    throw new Error(
      'AgentBuilder.thinking: already set. Each agent has at most one thinking-budget choice.',
    );
  }
  if (!Number.isFinite(opts.budget) || opts.budget <= 0) {
    throw new Error(
      `AgentBuilder.thinking: budget must be a positive finite number, got ${String(opts.budget)}.`,
    );
  }
  self.thinkingBudgetValue = opts.budget;
  return original;
}
