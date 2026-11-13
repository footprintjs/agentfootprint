import type { LLMProvider } from '../../../../provider-contract/types.js';
import type { AgentOptions } from '../../types.js';
import type { WindowStrategy } from '../../window/strategy.js';

export interface SummarizerIdentityPort {
  readonly opts: AgentOptions;
}

export interface WindowConflictPort {
  readonly windowStrategyValue?: WindowStrategy;
  readonly windowStrategyDoor?: '.window()' | '.compaction()' | '.act({ window })';
}

export function assertDistinctSummarizer(
  self: SummarizerIdentityPort,
  billing: { readonly provider: LLMProvider; readonly model: string } | undefined,
  label: string,
): void {
  if (billing === undefined) return;
  if (billing.provider !== self.opts.provider) return;
  if (billing.model !== self.opts.model) return;
  throw new Error(
    `${label}: the summarizer is the agent's own provider INSTANCE and the agent's own model ` +
      `('${billing.model}'). Those two calls now look identical and are not: the agent's call ` +
      `runs through reliability retries, any withRetry/withFallback/withCircuitBreaker ` +
      `decorator and the cache; the summarizer's call runs through none of them — one ` +
      `attempt, no fallback, no cache. A difference nobody typed is the kind this library ` +
      `refuses.\n` +
      `Fix, one word: give the summarizer its OWN instance — \`anthropic()\` written again ` +
      `(as \`summarizer\` on a window strategy, as \`llm\` on a summarize memory) rather than ` +
      `the variable you passed to Agent.create. That also stops the two roles sharing ` +
      `per-instance state. Or name a different (usually cheaper) model.`,
  );
}

export function assertWindowNotSet(
  self: Readonly<WindowConflictPort>,
  door: 'window' | 'compaction' | 'act',
): void {
  const existing = self.windowStrategyValue;
  if (existing === undefined) return;
  const setBy = self.windowStrategyDoor ?? '.window()';
  const law =
    'One window strategy per agent, whichever door set it — a second would silently ' +
    'override the first, and a window policy that quietly changed is a policy you cannot ' +
    'audit.';
  if (door === 'act') {
    throw new Error(
      `AgentBuilder.act: this agent already has a window strategy ('${existing.name}'), set ` +
        `by ${setBy}. ${law} Drop the \`window\` key here, or remove the ${setBy} call.`,
    );
  }
  if (door === 'compaction') {
    throw new Error(
      `AgentBuilder.compaction: this agent already has a window strategy ` +
        `('${existing.name}'), set by ${setBy}. ${law} \`.compaction()\`, \`.window()\` and ` +
        '`.act({ window })` are three doors into the same setting.',
    );
  }
  throw new Error(
    `AgentBuilder.window: this agent already has a window strategy ('${existing.name}'), set ` +
      `by ${setBy}. ${law} \`.compaction()\` is this same door with summarizeOldest already ` +
      'in it, and `.act({ window })` is it again inside the posture block.',
  );
}
