/**
 * thinkingSupport — `.thinking({ budget })` checked at BUILD against what each
 * provider declares for the model it will call (`LLMProvider.thinkingMode`).
 *
 * Every (provider, model) pair the agent's thinking request can reach is
 * asked: the agent's own, each per-skill brain, the escalation brain. A
 * model that cannot think (`'none'`) is refused here, by name, with an
 * `UnsupportedThinkingError` — rather than on the first call, or on the call
 * a fallback serves. An `'adaptive'` model takes no budget, and dev mode says
 * so once per model: configured and silently ignored must not look like
 * configured and working.
 *
 * Not checked here: a model `.configure()` picks at run time. The adapter
 * asks the same declaration on every request and refuses before sending.
 */

import { isDevMode } from 'footprintjs';
import type { LLMProvider } from '../../adapters/types.js';
import { UnsupportedThinkingError } from '../../thinking/errors.js';
import { thinkingModeFor } from '../../thinking/thinkingModeFor.js';
import type { FoldedSkillBrains } from './skillBrains.js';

/** One (provider, model) pair a thinking request can reach, and who declared it. */
interface ThinkingTarget {
  readonly provider: LLMProvider;
  readonly model: string;
  /** Where the pair comes from — named in the refusal. */
  readonly site: string;
}

/** Models already told that adaptive thinking takes no budget — once per model per process. */
const adaptiveWarned = new Set<string>();

/**
 * Refuse `.thinking()` for any reachable model whose provider declares it
 * cannot think; dev-warn for one that thinks adaptively (no budget).
 *
 * @throws UnsupportedThinkingError (`reason: 'no-thinking'`)
 * @throws TypeError when a provider's `thinkingMode` declaration is malformed
 */
export function checkThinkingSupport(args: {
  readonly budget: number;
  readonly provider: LLMProvider;
  readonly model: string;
  readonly brains?: FoldedSkillBrains;
}): void {
  for (const target of thinkingTargets(args)) {
    const mode = thinkingModeFor(target.provider, target.model);
    if (mode === 'none') {
      throw new UnsupportedThinkingError({
        provider: target.provider.name,
        model: target.model,
        reason: 'no-thinking',
        detail:
          `the provider declares this model cannot think, so .thinking({ budget: ${args.budget} }) ` +
          `cannot be honoured for ${target.site}. Use a model that thinks, or drop .thinking().`,
      });
    }
    if (mode === 'adaptive') warnBudgetNotSent(target, args.budget);
  }
}

/** The agent's own pair, then each brain's — a brain inherits what it leaves out. */
function thinkingTargets(args: {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly brains?: FoldedSkillBrains;
}): readonly ThinkingTarget[] {
  const targets: ThinkingTarget[] = [
    { provider: args.provider, model: args.model, site: 'the agent' },
  ];
  for (const [skillId, brain] of args.brains?.bySkill ?? []) {
    targets.push({
      provider: brain.provider ?? args.provider,
      model: brain.model ?? args.model,
      site: `skill '${skillId}'`,
    });
  }
  const escalation = args.brains?.escalation;
  if (escalation !== undefined) {
    targets.push({
      provider: escalation.provider,
      model: escalation.model ?? args.model,
      site: 'the escalation brain',
    });
  }
  return targets.filter(
    (t, i) => targets.findIndex((u) => u.provider === t.provider && u.model === t.model) === i,
  );
}

function warnBudgetNotSent(target: ThinkingTarget, budget: number): void {
  const key = JSON.stringify([target.provider.name, target.model]);
  if (adaptiveWarned.has(key) || !isDevMode()) return;
  if (adaptiveWarned.size < 500) adaptiveWarned.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint Agent: .thinking({ budget: ${budget} }) — '${target.model}' on ` +
      `'${target.provider.name}' thinks adaptively, which takes no budget: the model decides ` +
      `whether and how much to think, and the budget is not sent. The built-in Anthropic ` +
      `adapters still keep max_tokens above it, so a long think has room. This warning fires ` +
      `once per model per process.`,
  );
}
