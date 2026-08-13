/**
 * skillBrains — per-skill model switching (9.19.0). ONE owner of the brains
 * fold: the declared shapes (`ProviderChoice`, `EscalationPolicy`), the
 * build-time fold + check-up over BOTH declaration homes, and the runtime
 * `brainFor` consult callLLM makes.
 *
 * "THE CURSOR PICKS THE BRAIN." A skill graph already decides WHERE the run
 * is (the one cursor); this feature lets that same position decide WHO
 * answers — a cheap triage skill on a small model, the refund skill on the
 * strong one — with zero new stages: `callLLM` consults `brainFor(cursor,
 * escalated)` once at the top and resolves field by field down the stated
 * precedence chain:
 *
 *   **escalation > per-skill brain > `.configure()` `resolvedModel` >
 *   build-time default** — the more specific context wins (evidence > node
 *   > run > build). Field-by-field at the call site: `provider =
 *   brain?.provider ?? deps.provider`; `model = brain?.model ??
 *   (runConfigured ? scope.resolvedModel : undefined) ?? deps.model`;
 *   `cacheStrategy = brain?.cacheStrategy ?? deps.cacheStrategy`. A brain
 *   naming only a MODEL inherits the agent's provider; a brain naming only a
 *   foreign PROVIDER may not inherit the agent's model id (that id belongs
 *   to another vendor's namespace and would fail mid-turn, on exactly the
 *   iteration the cursor enters the skill) — refused at build instead.
 *
 * TWO declaration homes, one meaning: `defineSkill({ provider, model })`
 * keeps the choice beside the skill it serves; `SkillGraphOptions.providers`
 * keeps a fleet's choices in one place at the mount. The same id declared in
 * both with different choices is refused naming both homes — configuration
 * that disagrees with itself must not pick a silent winner.
 *
 * ESCALATE-ON-EVIDENCE. `escalation: { provider, model?, afterRefusals: N }`
 * — when the gate refuses N routing picks in ONE turn (`skill.rejected`,
 * reachability or posture — real recorded refusals, never vibes), the rest
 * of the turn runs on the escalation brain, `skill.escalated` goes on the
 * record once, and the next turn's seed de-escalates. The loop the model is
 * flubbing gets the bigger brain until the turn resolves.
 *
 * Vendor-neutral by construction: a brain is an `LLMProvider` OBJECT (any
 * port implementation), never a vendor name this library resolves.
 */

import type { LLMProvider } from '../../adapters/types.js';
import type { CacheStrategy } from '../../cache/types.js';
import { getDefaultCacheStrategy } from '../../cache/strategyRegistry.js';
import type { Injection } from '../../lib/injection-engine/types.js';

/** One brain: a provider port, optionally pinned to a model. `model` absent
 *  → resolved down the precedence chain (legal only while the provider is
 *  the agent's own — see the module header for why a foreign provider must
 *  name its model). */
export interface ProviderChoice {
  readonly provider: LLMProvider;
  readonly model?: string;
}

/** Escalate-on-evidence policy (see the module header). */
export interface EscalationPolicy extends ProviderChoice {
  /** Gate refusals (`skill.rejected` — reachability OR posture) in ONE turn
   *  that flip the rest of the turn onto this brain. Integer ≥ 1. */
  readonly afterRefusals: number;
}

/** A brain as the fold stores it: `defineSkill({ model })` alone is legal
 *  (the agent's own provider, another model), so `provider` is optional
 *  HERE while the declared `ProviderChoice` requires it. */
export interface SkillBrainDecl {
  readonly provider?: LLMProvider;
  readonly model?: string;
}

/** The two per-skill declaration homes, folded — plus the out-of-band
 *  policies. Produced by {@link foldSkillBrains} at `Agent.build()`. */
export interface FoldedSkillBrains {
  /** Per-skill brains, keyed by skill id (both homes merged, conflicts
   *  refused). Empty map = no per-skill brain anywhere. */
  readonly bySkill: ReadonlyMap<string, SkillBrainDecl>;
  readonly escalation?: EscalationPolicy;
  /** Tier-3 decider — consumed by the RouteTurn stage, never by callLLM. */
  readonly decider?: ProviderChoice;
}

/** What one `brainFor` consult resolves to — the winning rung, with the
 *  cache strategy that provider needs (cache markers are provider-aware).
 *  `provider`/`model` absent = that field falls to the next rung of the
 *  precedence chain at the call site. */
export interface ResolvedBrain {
  readonly provider?: LLMProvider;
  readonly model?: string;
  readonly cacheStrategy: CacheStrategy;
  /** WHY this brain won — stamped on `llm_start.brain` so the record says
   *  which rung answered, not just which model. */
  readonly via: 'skill' | 'escalation';
  /** The tenure that picked it (via `'skill'` only). */
  readonly skillId?: string;
}

/** The consult callLLM makes once at the top of the stage, with the
 *  ADVANCED cursor and the run's escalation flag. Undefined result = no
 *  brain rung won; the agent's own configuration resolves as always. */
export type BrainFor = (
  activeCursor: string | undefined,
  escalated: boolean,
) => ResolvedBrain | undefined;

/** The per-skill brain declared on `defineSkill({ provider, model })`,
 *  read off the metadata bag (the engine-ignores-unknown precedent —
 *  `projectActiveInjection` never projects it, so the live provider object
 *  stays on the closure-held list and never crosses a scope boundary). */
export function skillBrainOf(injection: Injection): SkillBrainDecl | undefined {
  const meta = injection.metadata as { provider?: LLMProvider; model?: string } | undefined;
  if (meta?.provider === undefined && meta?.model === undefined) return undefined;
  return {
    // `model` alone is legal — the agent's own provider, another model.
    ...(meta.provider !== undefined && { provider: meta.provider }),
    ...(meta.model !== undefined && { model: meta.model }),
  };
}

/** Inputs to the fold — everything the check-up judges against. */
export interface FoldSkillBrainsArgs {
  /** The FINAL injection list (every declaration home has landed). */
  readonly injections: readonly Injection[];
  /** The mount options' three fields, verbatim. */
  readonly providers?: Readonly<Record<string, ProviderChoice>>;
  readonly escalation?: EscalationPolicy;
  readonly decider?: ProviderChoice;
  /** Whether a skill graph is mounted at all (`.skillGraph()` ran). */
  readonly graphMounted: boolean;
  /** The mounted graph's node ids — undefined when the graph object carries
   *  no `nodes` (a structurally-typed graph built before they existed);
   *  brains cannot be validated against such a graph and are refused. */
  readonly nodeIds?: ReadonlySet<string>;
  /** The agent's own provider name — the foreign-provider check's anchor. */
  readonly agentProviderName: string;
}

/**
 * Fold both declaration homes into one frozen map, running every build-time
 * refusal (the check-up). Returns `undefined` when nothing was declared —
 * the zero-cost gate every caller branches on.
 */
export function foldSkillBrains(args: FoldSkillBrainsArgs): FoldedSkillBrains | undefined {
  const fromOptions = new Map<string, SkillBrainDecl>(Object.entries(args.providers ?? {}));
  const fromSkills = new Map<string, SkillBrainDecl>();
  for (const inj of args.injections) {
    if (inj.flavor !== 'skill') continue;
    const brain = skillBrainOf(inj);
    if (brain) fromSkills.set(inj.id, brain);
  }
  const declaredAnything =
    fromOptions.size > 0 ||
    fromSkills.size > 0 ||
    args.escalation !== undefined ||
    args.decider !== undefined;
  if (!declaredAnything) return undefined;

  // A brain with no cursor to pick it: "the cursor picks the brain", and an
  // agent without a graph has no cursor. Refused rather than silently inert.
  if (!args.graphMounted) {
    const ids = [...new Set([...fromOptions.keys(), ...fromSkills.keys()])];
    const what =
      ids.length > 0
        ? `per-skill brains (${ids.map((id) => `'${id}'`).join(', ')})`
        : args.escalation !== undefined
        ? 'an escalation policy'
        : 'a routing decider';
    throw new Error(
      `Agent.build(): ${what} declared, but no skill graph is mounted — the cursor picks ` +
        `the brain, and without .skillGraph() there is no cursor, so the declaration would ` +
        `never serve a single call. Mount a graph, or drop the provider/model declarations.`,
    );
  }
  if (args.nodeIds === undefined) {
    throw new Error(
      `Agent.build(): per-skill brains / escalation / decider were declared, but the mounted ` +
        `graph object carries no \`nodes\` — the brain check-up cannot tell a skill id from a ` +
        `typo against it. Build the graph with this version's skillGraph() (every graph it ` +
        `builds carries nodes), or drop the declarations.`,
    );
  }

  // Foreign-provider-without-model: decidable at build, guaranteed wrong at
  // run (the agent's model id belongs to another vendor's namespace).
  const requireModelOnForeign = (choice: SkillBrainDecl, where: string): void => {
    if (choice.model !== undefined) return;
    if (choice.provider === undefined || choice.provider.name === args.agentProviderName) return;
    throw new Error(
      `Agent.build(): ${where} names provider '${choice.provider.name}' without a model. The ` +
        `run's configured model belongs to '${args.agentProviderName}' and cannot be resolved ` +
        `against a different provider — the call would fail mid-turn, on exactly the ` +
        `iteration this brain first serves. Name the model for it (inheritance down the ` +
        `chain stays legal when the provider matches the agent's).`,
    );
  };

  // Merge the two homes. Same id + same choice = fine (one fact said twice);
  // different choices = a disagreement no silent winner may resolve.
  const bySkill = new Map<string, SkillBrainDecl>();
  for (const [skillId, choice] of fromSkills) bySkill.set(skillId, choice);
  for (const [skillId, choice] of fromOptions) {
    const other = fromSkills.get(skillId);
    if (other !== undefined) {
      const sameProvider = other.provider === choice.provider;
      const sameModel = other.model === choice.model;
      if (!sameProvider || !sameModel) {
        throw new Error(
          `Agent.build(): skill '${skillId}' declares a brain in BOTH homes with different ` +
            `choices — defineSkill({ provider: ${describeChoice(other)} }) and ` +
            `skillGraph options.providers['${skillId}'] = ${describeChoice(choice)}. Two ` +
            `homes may repeat one choice; they may not disagree. Keep one declaration, or ` +
            `make them identical.`,
        );
      }
    }
    bySkill.set(skillId, choice);
  }

  for (const [skillId, choice] of bySkill) {
    if (!args.nodeIds.has(skillId)) {
      throw new Error(
        `Agent.build(): a brain is declared for skill '${skillId}', but the mounted graph ` +
          `has no node with that id — the cursor can never land there, so the brain would ` +
          `never serve a call. Fix the id, wire the skill into the graph, or drop the ` +
          `declaration.`,
      );
    }
    // `model` alone (provider undefined in the defineSkill home) is the
    // agent's own provider — nothing foreign to check.
    if (choice.provider !== undefined) {
      requireModelOnForeign(choice, `skill '${skillId}''s brain`);
    }
  }

  if (args.escalation !== undefined) {
    const n = args.escalation.afterRefusals;
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `Agent.build(): escalation.afterRefusals must be an integer ≥ 1 (got ${String(n)}). ` +
          `It counts recorded gate refusals (skill.rejected) in one turn before the flip — ` +
          `0 would mean "always escalated", which is not escalation but a different default ` +
          `brain; declare that as the agent's provider/model instead.`,
      );
    }
    requireModelOnForeign(args.escalation, 'the escalation brain');
  }
  if (args.decider !== undefined) {
    requireModelOnForeign(args.decider, 'the routing decider');
  }

  return {
    bySkill,
    ...(args.escalation !== undefined && { escalation: args.escalation }),
    ...(args.decider !== undefined && { decider: args.decider }),
  };
}

function describeChoice(c: SkillBrainDecl): string {
  const provider = c.provider !== undefined ? `provider '${c.provider.name}'` : 'agent provider';
  return c.model !== undefined ? `${provider}, model '${c.model}'` : provider;
}

/** Per-brain cache strategies, resolved ONCE at chart build (the brain set
 *  is static; cache markers are provider-aware). A brain on the agent's own
 *  provider keeps the agent's strategy — including an explicit override —
 *  rather than re-resolving the default behind the caller's back. */
export interface BuildBrainForArgs {
  readonly brains: FoldedSkillBrains;
  readonly agentProviderName: string;
  readonly agentCacheStrategy: CacheStrategy;
}

/** Build the runtime consult. See {@link BrainFor}. */
export function buildBrainFor(args: BuildBrainForArgs): BrainFor {
  const strategyFor = (provider: LLMProvider | undefined): CacheStrategy =>
    provider === undefined || provider.name === args.agentProviderName
      ? args.agentCacheStrategy
      : getDefaultCacheStrategy(provider.name);

  const bySkill = new Map<string, ResolvedBrain>();
  for (const [skillId, choice] of args.brains.bySkill) {
    bySkill.set(skillId, {
      provider: choice.provider,
      ...(choice.model !== undefined && { model: choice.model }),
      cacheStrategy: strategyFor(choice.provider),
      via: 'skill',
      skillId,
    });
  }
  const escalation: ResolvedBrain | undefined = args.brains.escalation
    ? {
        provider: args.brains.escalation.provider,
        ...(args.brains.escalation.model !== undefined && {
          model: args.brains.escalation.model,
        }),
        cacheStrategy: strategyFor(args.brains.escalation.provider),
        via: 'escalation',
      }
    : undefined;

  return (activeCursor, escalated) => {
    // Evidence outranks the node: once the turn escalated, EVERY remaining
    // call of the turn runs on the escalation brain, whatever the cursor.
    if (escalated && escalation !== undefined) return escalation;
    if (activeCursor === undefined) return undefined;
    return bySkill.get(activeCursor);
  };
}

/** Describe the brain that WOULD serve a cursor pre-escalation — the
 *  `skill.escalated` event's honest `from` field, resolved by the same
 *  precedence chain callLLM applies (skill brain > configured > default). */
export function describeServingBrain(args: {
  readonly brains: FoldedSkillBrains;
  readonly cursor: string | undefined;
  readonly agentProviderName: string;
  readonly defaultModel: string;
  readonly resolvedModel?: string;
}): { readonly provider: string; readonly model: string } {
  const brain = args.cursor !== undefined ? args.brains.bySkill.get(args.cursor) : undefined;
  const provider = brain?.provider?.name ?? args.agentProviderName;
  const model = brain?.model ?? args.resolvedModel ?? args.defaultModel;
  return { provider, model };
}
