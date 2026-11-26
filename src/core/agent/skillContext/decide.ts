/**
 * The skill-context decision: evaluated ONCE per agent, here, where its
 * configuration is assembled from its provider, model, brains and final skill
 * list (`runtime/configuration/configure.ts` · `configureAgent`).
 *
 * The fenced skill core owns the tables and the fact names
 * (`injection-engine/skillContext.ts`) and evaluates nothing; this is the
 * first layer above it that may import the engine, so `decideFromFacts`
 * evaluates them here, and `decisionRecord` / `fixedRecord` make the records
 * the call stage puts on `llm_start`. Nothing re-decides it per run, per
 * request or on resume.
 */
import { decideFromFacts, decisionRecord, fixedRecord } from 'footprintjs';
import type { DecisionRecord } from 'footprintjs';
import type { SkillContextRecord } from '../../../events/payloads/skillContext.js';
import {
  SKILL_BODY_MEASUREMENT,
  SKILL_BODY_TABLE,
  SKILL_TOOL_TABLE,
  stricterBinding,
  type SkillContextStrategy,
  type SkillToolFacts,
} from '../../../injection-engine/skillContext.js';
import type { Injection } from '../../../injection-engine/types.js';
import { thinkingBindingOf } from '../../../provider-contract/thinkingBinding.js';
import type { LLMProvider } from '../../../provider-contract/types.js';
import type { FoldedSkillBrains } from '../skillBrains.js';

export interface SkillContextDecision {
  readonly strategy: SkillContextStrategy;
  /** What `llm_start.skillContext` carries. */
  readonly record: SkillContextRecord;
  /**
   * `false` only when the tool table's DEFAULT chose `declared` (every unbound
   * model): such a run keeps its exact event bytes, so nothing is recorded.
   */
  readonly recorded: boolean;
}

export interface SkillContextInputs {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly brains?: FoldedSkillBrains;
  /** `AgentOptions.skillContext`, as the app wrote it. */
  readonly stated?: unknown;
  readonly injections: readonly Injection[];
}

const STRATEGIES: readonly unknown[] = ['listed', 'declared'];

/** Every (provider, model) the agent's own tool-turn calls can go to: the agent, each skill brain, the escalation. */
function callTargets(inputs: SkillContextInputs) {
  const targets = [{ provider: inputs.provider, model: inputs.model }];
  for (const brain of inputs.brains?.bySkill.values() ?? [])
    targets.push({
      provider: brain.provider ?? inputs.provider,
      model: brain.model ?? inputs.model,
    });
  const escalation = inputs.brains?.escalation;
  if (escalation !== undefined)
    targets.push({ provider: escalation.provider, model: escalation.model ?? inputs.model });
  return targets;
}

/** The strictest binding answer over the call targets, and the target that gave it. */
function strictestBinding(inputs: SkillContextInputs): SkillContextRecord['binding'] {
  const rows = callTargets(inputs).map(({ provider, model }) => {
    const answer = thinkingBindingOf(provider, model);
    return { binding: answer.binding, by: answer.by, provider: provider.name, model };
  });
  return rows.reduce((best, row) =>
    stricterBinding(best.binding, row.binding) !== best.binding ? row : best,
  );
}

/** The record without the engine's optional keys when they are absent (a plain, cloneable row). */
function plain<S extends string>(record: DecisionRecord) {
  return {
    strategy: record.strategy as S,
    by: record.by,
    ...(record.rule !== undefined && { rule: record.rule }),
    ...(record.label !== undefined && { label: record.label }),
    reads: [...record.reads],
    ...(record.voucher !== undefined && { voucher: record.voucher }),
  };
}

/**
 * Decide, or `undefined` when the agent registers no skill (nothing to decide,
 * nothing recorded). A stated value other than the two strategies is refused
 * at build, naming the option.
 *
 * @example
 *   decideSkillContext({ provider: anthropic(), model: 'claude-haiku-5-5', injections })?.strategy; // 'listed'
 *   decideSkillContext({ provider: openai(), model: 'gpt-5', injections })?.strategy;              // 'declared'
 */
export function decideSkillContext(inputs: SkillContextInputs): SkillContextDecision | undefined {
  if (inputs.stated !== undefined && !STRATEGIES.includes(inputs.stated))
    throw new TypeError("Agent: skillContext must be 'listed' or 'declared'.");
  if (!inputs.injections.some((injection) => injection.flavor === 'skill')) return undefined;
  const binding = strictestBinding(inputs);
  const facts: SkillToolFacts = { binding: binding.binding };
  const tools =
    inputs.stated !== undefined
      ? fixedRecord(inputs.stated as string, undefined, 'app')
      : decisionRecord(
          decideFromFacts(SKILL_TOOL_TABLE.rules, facts, SKILL_TOOL_TABLE.default).evidence,
        );
  const strategy = tools.strategy as SkillContextStrategy;
  const body = decisionRecord(
    decideFromFacts(SKILL_BODY_TABLE.rules, { tools: strategy }, SKILL_BODY_TABLE.default).evidence,
  );
  return {
    strategy,
    record: {
      tools: plain<SkillContextStrategy>(tools),
      body: {
        ...plain<'tool-result' | 'declared'>(body),
        measurement: { ...SKILL_BODY_MEASUREMENT },
      },
      binding,
    },
    recorded: !(tools.by === 'default' && strategy === 'declared'),
  };
}
