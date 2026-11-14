import type { LLMProvider } from '../../../../provider-contract/types.js';
import { resolveCompactionOptions } from '../../window/options.js';
import { summarizeOldest } from '../../window/strategies/summarizeOldest.js';
import type { WindowStrategy } from '../../window/strategy.js';
import type { CompactionOptions } from '../../window/types.js';

export interface WindowConfigurationPort {
  windowStrategyValue?: WindowStrategy;
  windowStrategyDoor?: '.window()' | '.compaction()' | '.act({ window })';
  assertNoWindowStrategy(door: 'window' | 'compaction' | 'act'): void;
  assertSummarizerIsNotTheAgentItself(
    billing: { readonly provider: LLMProvider; readonly model: string } | undefined,
    label: string,
  ): void;
  noteWindowStrategyDoor(door: '.window()' | '.compaction()' | '.act({ window })'): void;
}

export function setWindowStrategy(
  self: WindowConfigurationPort,
  strategy: WindowStrategy,
  original: object,
): object {
  self.assertNoWindowStrategy('window');
  if (
    strategy === null ||
    typeof strategy !== 'object' ||
    typeof strategy.plan !== 'function' ||
    typeof strategy.name !== 'string' ||
    strategy.name.length === 0
  ) {
    throw new Error(
      `AgentBuilder.window: expected a WindowStrategy — an object with a non-empty \`name\` ` +
        `and a \`plan(input)\` method — got ${typeof strategy}. The shipped ones are ` +
        `summarizeOldest({ ... }), slidingWindow({ ... }) and tokenBudget({ ... }); call the ` +
        `factory, do not pass it.`,
    );
  }
  self.assertSummarizerIsNotTheAgentItself(strategy.billing, 'AgentBuilder.window');
  self.windowStrategyValue = strategy;
  // `.act({ window })` delegates here, and its own door was noted first —
  // do not overwrite a more specific attribution with this generic one.
  self.noteWindowStrategyDoor(self.windowStrategyDoor ?? '.window()');
  return original;
}

export function setCompaction(
  self: WindowConfigurationPort,
  options: CompactionOptions,
  original: object,
): object {
  self.assertNoWindowStrategy('compaction');
  // Validated here so the error names the door the caller actually used;
  // `summarizeOldest` re-runs the SAME validator under its own label, so the
  // two doors can never drift into accepting different things.
  const resolved = resolveCompactionOptions(options, 'AgentBuilder.compaction');
  self.assertSummarizerIsNotTheAgentItself(
    { provider: resolved.summarizer, model: resolved.model },
    'AgentBuilder.compaction',
  );
  self.windowStrategyValue = summarizeOldest(options);
  self.noteWindowStrategyDoor('.compaction()');
  return original;
}
