/**
 * skillContext — which way a skill's tools and body reach the model, as DATA.
 *
 * Two strategies. `declared` is each skill's own declarations: a scoped skill's
 * tools (`autoActivate: 'currentSkill'`) join the tool list when it activates,
 * and its body goes where its `surfaceMode` says. `listed` is for a model that
 * binds its reasoning to the context it was written under: every skill tool is
 * listed from the first request, a body `read_skill` loads is that call's
 * result, so loading a skill changes nothing a signed thinking block was
 * written under.
 *
 * Zone: PURE CORE. This file owns the rule tables and the fact names and
 * evaluates nothing: the tables are written in `decide()`'s grammar over FLAT
 * fact names, and the first layer above the fence that may import the engine
 * (`core/agent/skillContext/decide.ts`) evaluates them with `decideFromFacts`.
 * The rule types below are structural copies of the engine's filter rules, so
 * this file imports no chart or runtime engine code.
 */

import { sha256Hex } from '../lib/sha256.js';
import {
  skillBodyOrigin,
  carriesSkillDefinition,
  type SkillBodyHistoryMessage,
} from './skillBodyEvidence.js';

/** The two strategies. */
export type SkillContextStrategy = 'listed' | 'declared';

/** Where a loaded skill's body travels: the `read_skill` result, or as each skill declares. */
export type SkillBodyChannel = 'tool-result' | 'declared';

/** The facts the tool table reads, by name. */
export interface SkillToolFacts {
  /** The strictest binding answer over every provider and model the agent's own calls reach. */
  readonly binding: 'bound' | 'unknown' | 'unbound';
}

/** The facts the body table reads, by name. */
export interface SkillBodyFacts {
  /** The tool table's answer. */
  readonly tools: SkillContextStrategy;
}

/** One rule in `decide()`'s filter grammar, over flat fact names. */
export interface SkillContextRule<F> {
  readonly when: { readonly [K in keyof F]?: { readonly eq?: F[K] } };
  readonly then: string;
  readonly label: string;
}

/** A table: its rules in order (first match wins) and its labelled default. */
export interface SkillContextTable<F> {
  readonly rules: readonly SkillContextRule<F>[];
  readonly default: { readonly branch: string; readonly label: string };
}

/** The tool strategy, decided from the model's binding. */
export const SKILL_TOOL_TABLE: SkillContextTable<SkillToolFacts> = Object.freeze({
  rules: Object.freeze([
    Object.freeze({
      when: Object.freeze({ binding: Object.freeze({ eq: 'bound' as const }) }),
      then: 'listed',
      label: 'The model binds its reasoning to the context it was written under',
    }),
    Object.freeze({
      when: Object.freeze({ binding: Object.freeze({ eq: 'unknown' as const }) }),
      then: 'listed',
      label:
        'The provider cannot tell whether the model binds its reasoning, so it is treated as bound',
    }),
  ]),
  default: Object.freeze({
    branch: 'declared',
    label: "The model does not bind its reasoning: each skill's own declarations apply",
  }),
});

/** The body channel, decided from the tool strategy. */
export const SKILL_BODY_TABLE: SkillContextTable<SkillBodyFacts> = Object.freeze({
  rules: Object.freeze([
    Object.freeze({
      when: Object.freeze({ tools: Object.freeze({ eq: 'listed' as const }) }),
      then: 'tool-result',
      label: 'With every skill tool listed, a body loaded by read_skill travels in its result',
    }),
  ]),
  default: Object.freeze({ branch: 'declared', label: "Each skill's own surfaceMode" }),
});

/**
 * The measurement that chose the `read_skill` result as the body channel: on
 * Claude Haiku 5.5 the model followed a skill body 20 of 20 times in that
 * channel, in the two appended channels and in the control. A later
 * measurement that changes the channel changes this pair, so old and new runs
 * say which one they followed.
 */
export const SKILL_BODY_MEASUREMENT = Object.freeze({
  script: 'skill-body-measure-20261125/measure.mjs',
  run: '2026-11-25T22-14-20-690Z',
});

/** Order of strictness for the binding fact: the strictest answer wins. */
const STRICTNESS = { unbound: 0, unknown: 1, bound: 2 } as const;

/** The stricter of two binding answers (`bound` > `unknown` > `unbound`). */
export function stricterBinding(
  a: SkillToolFacts['binding'],
  b: SkillToolFacts['binding'],
): SkillToolFacts['binding'] {
  return STRICTNESS[b] > STRICTNESS[a] ? b : a;
}

/**
 * The skill text contributed by the system slot from this active projection.
 * Its surface mode has already accounted for the turn's tool history.
 */
export function systemSkillBody(injection: {
  readonly flavor: string;
  readonly surfaceMode?: string;
  readonly inject: { readonly systemPrompt?: string };
}): string | undefined {
  const body = injection.inject.systemPrompt;
  return injection.flavor === 'skill' && injection.surfaceMode !== 'tool-only' && body
    ? body
    : undefined;
}

/** Is this definition already carried by a produced and still-present result? */
export function bodyInHistory(
  skillId: string,
  body: string | undefined,
  history: readonly SkillBodyHistoryMessage[] | undefined,
): boolean {
  if (!body || !history) return false;
  const digest = sha256Hex(body);
  return history.some((message) => {
    const origin = skillBodyOrigin(message);
    return origin?.skillId === skillId && carriesSkillDefinition(message, origin, digest);
  });
}

/**
 * The surface mode a skill is served with on THIS iteration. Under `listed` a
 * body whose `read_skill` result is in the history is `tool-only` (the system
 * prompt leaves it out, so it is in the request exactly once); otherwise the
 * skill's own declaration, as under `declared`: a body nothing else carries
 * goes into the system prompt rather than nowhere.
 */
export function servedSurfaceMode(
  meta: { readonly surfaceMode?: string; readonly skillContext?: unknown } | undefined,
  skillId: string,
  body: string | undefined,
  history: readonly SkillBodyHistoryMessage[] | undefined,
): string | undefined {
  if (meta?.skillContext === 'listed' && bodyInHistory(skillId, body, history)) return 'tool-only';
  return meta?.surfaceMode;
}
