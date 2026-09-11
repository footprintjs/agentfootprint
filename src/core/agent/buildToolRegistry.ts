// MAP · the declared dispatch surface: three sources composed once at build time.
// It decides what EXISTS, never what a given caller is shown — the role filter and the parked
// suppression are applied downstream by the tools slot (a Lens). The law block below is pinned
// by tests; it is left exactly as written.
/**
 * buildToolRegistry — pure function that composes the agent's
 * augmented tool registry from three sources:
 *
 *   1. **Static registry** — tools registered via `.tool()`. Always
 *      visible to the LLM; always executable.
 *   2. **`read_skill`** — auto-attached when ≥1 Skill is registered.
 *      Activation tool for LLM-guided Skills.
 *   3. **Skill-supplied tools** (`Skill.inject.tools[]`) — visible
 *      only when the Skill is active (filtered by tools-slot subflow);
 *      MUST always be in the executor registry so when the LLM calls
 *      one, the tool-calls handler can dispatch.
 *
 * Tool-name uniqueness is enforced across all three sources at build
 * time. The LLM only sees `tool.schema.name` (no ids), so names ARE
 * the runtime dispatch key — collisions break the LLM's ability to
 * call the right tool. Throw early instead of subtly shadowing.
 *
 * **Block C runtime — `autoActivate: 'currentSkill'` semantics:**
 * When a skill's `defineSkill({ autoActivate: 'currentSkill' })` is
 * set, its tools are EXCLUDED from the static registry. They flow
 * into the LLM's tool list ONLY through `dynamicSchemas` (the
 * buildToolsSlot path that reads activeInjections), which means
 * they're visible ONLY on iterations after the skill is activated by
 * `read_skill('id')`. Without this, the LLM sees every skill's tools
 * on every iteration and the per-skill-narrowing autoActivate
 * promised in `defineSkill` doesn't actually narrow anything. Skills
 * WITHOUT autoActivate keep the v2.4 behavior (tools always visible)
 * for back-compat.
 *
 * **autoActivate dispatch invariant:** autoActivate skill tools live
 * OUTSIDE the LLM-visible registry (so they don't pollute the
 * per-iteration tool list before the skill activates), but they MUST
 * still be findable by the dispatch handler — the LLM calls them by
 * name once the skill is active, and dispatch looks up by name. We
 * add them to the dispatch map (`registryByName`) so `lookupTool`
 * resolves correctly.
 *
 * ── THE CAPABILITY LAW, EPOCH-SCOPED ──────────────────────────────────
 *
 * An EPOCH is one composed request plus the dispatch of the tool calls
 * that request comes back with. For one epoch E:
 *
 *   every offered capability resolves to a dispatchable implementation
 *   with stable identity. Attention may alter the offer. Omission from
 *   the offer must NOT be presented as proof of permanent capability loss.
 *
 * Clause one is what the two maps returned from here are FOR, and it is
 * scoped to THE TOOLS THIS FILE ROUTES. `augmentedRegistry` (plus the
 * per-iteration narrowing the tools slot applies downstream) is this file's
 * CONTRIBUTION to the offer; `registryByName` is DISPATCH. It is not the
 * whole offer: the wire list is assembled one layer out, as
 * `[static, provider, skill, step]` merged first-occurrence-wins
 * (`buildToolsSlot`), and PROVIDER schemas are a source these maps never
 * contain. Within the scoped set, a name in the offer that is missing from
 * dispatch is an `Unknown tool` the model was invited to call — which is why
 * the autoActivate invariant above exists, and why the name-uniqueness throws
 * below are throws: an identity that is not stable is one the model cannot
 * address. Where a provider schema reaches the wire ahead of a skill tool of
 * the same name, the identity half WAS the SHADOW SEAM illustrated below —
 * closed in 9.92.0 by making dispatch follow the offer.
 *
 * `with stable identity` is kept rather than dropped, and the reason is the
 * event. A law reading only "every offered name resolves to something" would
 * be true everywhere and would leave `agentfootprint.tools.shadowed` reporting
 * a deviation from nothing — the framework spends an event on that seam
 * precisely because reading one contract and calling another implementation is
 * a violation of an expectation worth naming. Since 9.92.0 the clause HOLDS
 * for every name on the wire (dispatch follows the offer); the event now names
 * the collision that would have broken it, and its companion
 * `agentfootprint.tools.claim_swallowed` names the party the collision silenced.
 *
 * Clause two is the whole point of the narrowing dials — `autoActivate`,
 * `skillGraph({ scopeTools })`, `.toolsFromActiveSkill()`, a parked map,
 * an open step tenure. Every one of them subtracts from the OFFER.
 *
 * Clause three is a rule about SENTENCES, and nothing in this file can
 * enforce it; the surfaces that write them are inventoried by
 * `test/modelFacingSurfaces.test.ts` and judged by
 * `test/helpers/modelFacingClaims.ts`. It is stated HERE because this is
 * where a reader learns what an offer is, and therefore where the wrong
 * inference is cheapest to draw: a tool absent from this iteration's list
 * is a tool the attention policy did not put there, never a capability
 * that has been taken away.
 *
 * ── WHAT THE LAW DELIBERATELY DOES NOT SAY ────────────────────────────
 *
 * Three drafts of it read "position governs the offer, never dispatch".
 * That generalisation is FALSE across the framework, and it is false in a
 * direction that matters: it would license telling a model that anything
 * it once saw is still callable. It holds for the tools THIS file routes —
 * a scoped skill tool leaves `augmentedRegistry` and stays in
 * `registryByName`, which is exactly the invariant above. It does not hold
 * where the implementation never lived in these maps, or where the SCHEMA
 * the model read never did.
 *
 * ── WHERE IT DOES NOT HOLD IS NOT WRITTEN DOWN HERE ───────────────────
 *
 * It used to be: a list, in this comment, that called itself complete. It was
 * wrong three times in three rounds — round 1 missed provider tools vanishing
 * cross-epoch, round 2 the same-epoch provider/skill shadow, round 3 an
 * INACTIVE skill shadowing silently and a provider able to claim `skip_step`.
 * Each round stated the list more precisely and each round an independent
 * check found one more. A hand-maintained enumeration that claims completeness
 * is the exact defect this library exists to fix, one level up, so this one is
 * no longer maintained by hand:
 *
 *   THE ENUMERATION IS `test/core/agent/toolDivergenceWalk.test.ts`.
 *
 * It walks the configuration space — every source that can put a name on the
 * wire or answer to one, crossed with the narrowings that change resolution —
 * drives a REAL run per configuration, and records per epoch what name was
 * offered, whose contract was on the wire, whose implementation answered, and
 * whether `agentfootprint.tools.shadowed` fired and what it claimed. Its
 * committed baseline is the list this comment used to be, kept by observation
 * instead of by memory: a divergence missing from it fails, and one that stops
 * appearing fails too. Read it for the SET, and for the reason each member is
 * tolerated.
 *
 * What follows is ILLUSTRATION — the seams a reader of THIS file meets first,
 * so the two maps below make sense. It is not a boundary, and nothing here
 * should be read as "and no others":
 *
 *   • PROVIDER-DELIVERED tools (`ToolProvider`). Dispatch resolves those
 *     from `providerToolCache.current`, which the Tools slot OVERWRITES
 *     with this iteration's `provider.list(ctx)` (buildToolsSlot.ts). So
 *     `skillScopedTools(id, …)`, which answers `[]` whenever
 *     `ctx.activeSkillId` is not its skill — and that field reports only a
 *     `read_skill` activation — drops the tool out of the offer and out of
 *     dispatch on the SAME epoch.
 *     Same-epoch offer implies same-epoch dispatch; the cross-epoch half is
 *     simply not true there.
 *   • `read_skill` RECOVERY is cursor-gated, so it is not the escape hatch
 *     that would make the cross-epoch claim harmless anyway.
 *     `makeReachableSkills` filters the cursor out of its own successor set,
 *     and under `.tree()` the reachable set is `() => []` outright
 *     (skillGraph.ts) — a tree routes by predicate and has no cursor to move.
 *   • The SHADOW SEAM — the SAME-EPOCH divergence this file's two maps used
 *     to produce, CLOSED in 9.92.0 and kept here because a reader meeting
 *     the maps has to know why dispatch no longer reads them first. A
 *     `ToolProvider` and a skill can declare the same tool name. The wire
 *     merge puts provider schemas ahead of skill injections
 *     first-occurrence-wins, so the model reads the PROVIDER's contract; until
 *     9.92.0 `lookupTool` checked `registryByName` first, where every skill
 *     tool lives and no provider tool does, so the SKILL's `execute` ran —
 *     the contract offered and the implementation that answered were
 *     different tools, inside ONE epoch, and an INACTIVE skill could answer
 *     a call it was never offered. Now DISPATCH FOLLOWS THE OFFER: the tools
 *     slot records which party put each name on the wire (`ServedToolParties`,
 *     buildToolsSlot.ts) and `lookupTool` resolves a name on the wire to THAT
 *     party's implementation; `registryByName` is the fallback for a name
 *     that is not on this epoch's wire at all (the held-out, parked and
 *     restored-transcript cases the capability law keeps dispatchable) —
 *     reached only for the party the model LAST read the name under, or the
 *     name's only holder when it was never served, and put on the record by
 *     `agentfootprint.tools.answered_off_wire`; a name whose last-served
 *     party can no longer answer is refused (`toolCalls.ts` ·
 *     `notServedResult`), never handed to a party the model was not shown
 *     under that name. The
 *     collision itself is still REPORTED rather than refused, because nothing
 *     here can see it coming: the provider's list is resolved per iteration
 *     (`list(ctx)`), so there is no build-time moment at which the pair is
 *     knowable. The pair this file CAN see — a static `.tool()` against a
 *     skill tool — is refused upstream (`validators.ts` ·
 *     `validateToolNameUniqueness`), which is the better answer whenever the
 *     answer is available that early. `agentfootprint.tools.shadowed` names
 *     the wire's party (now the same party in both of its halves) every
 *     iteration two contracts compete, and `agentfootprint.tools.claim_swallowed`
 *     names every party whose claim is dead that iteration — the loser of a
 *     competition, and the claimant that never even reached the merge (a
 *     provider tool whose name a registry holder owns, a skill tool named
 *     after a framework auto-attach). `toolClaimants` below is what makes the
 *     second event possible: the list of who claimed a name, kept instead of
 *     collapsed to a winner. Pinned by `test/toolShadowing.test.ts`,
 *     `test/core/tools/offer-and-answer.test.ts` and epoch-laws 1(g).
 *
 * MCP does not add a seam of its OWN, and it is worth saying so because it
 * looks like it does: `mcpServe` builds `listing` and `byName` ONCE at
 * construction from the same array, and every server instance installs
 * those same two captures, so the offer and the dispatch map there cannot
 * diverge at all. What it does add is a mount: an MCP source reaches an agent
 * as `staticTools(await client.tools())` — a `ToolProvider` — so it inherits
 * every provider seam above unchanged. The walk drives both and gets the same
 * rows for each, which is the only way that claim is worth making.
 *
 * Pinned by `test/core/agent/epoch-laws.test.ts` (the law) and
 * `test/core/agent/toolDivergenceWalk.test.ts` (the set).
 */

import { buildReadSkillTool, buildSkipStepTool } from '../../lib/injection-engine/skillTools.js';
import { stepsOf, SKIP_STEP_TOOL_NAME } from '../../lib/injection-engine/skillSteps.js';
import type { Injection } from '../../lib/injection-engine/types.js';
import type { LLMToolSchema } from '../../adapters/types.js';
import { PRESENT_TOOL_NAME } from '../../artifacts/present.js';
import { buildPresentTool } from './presentTool.js';
import { warnIfInvalidToolName, type Tool, type ToolRegistryEntry } from '../tools.js';
import type { ToolNameChannel } from '../../events/payloads.js';

/**
 * One party's claim to a tool name, as declared at build (9.92.0).
 *
 * `channel` is the vocabulary `tools.shadowed` / `tools.claim_swallowed` name
 * parties in; `id` is the skill id for a skill's claim (a static `.tool()` and
 * a framework auto-attach carry none). `tool` is the implementation that
 * answers when THIS claim is the one on the wire.
 */
export interface ToolClaim {
  readonly channel: Exclude<ToolNameChannel, 'provider'>;
  readonly id?: string;
  readonly tool: Tool;
}

export interface ToolRegistryArtifacts {
  /** All tools the LLM sees in the static portion of its tool list
   *  (registry + read_skill + non-autoActivate skill tools). */
  readonly augmentedRegistry: readonly ToolRegistryEntry[];
  /** Dispatch map by name — used by the tool-calls handler at run
   *  time to resolve a tool the LLM called. INCLUDES autoActivate
   *  skill tools (which aren't in `augmentedRegistry`) so dispatch
   *  works once the skill is active. */
  readonly registryByName: ReadonlyMap<string, Tool>;
  /** Static tool schemas for the LLM call. Mirrors `augmentedRegistry`
   *  shape; passed to `buildToolsSlot` + the seed stage as the
   *  per-iteration default before the dynamic tools slot has run. */
  readonly toolSchemas: readonly LLMToolSchema[];
  /**
   * WHICH SKILLS DECLARE EACH TOOL NAME (9.86.0) — tool name → the ids of the
   * skills whose `inject.tools` carry it, in declaration order.
   *
   * This walk already happened here; it was thrown away, and the one consumer
   * that needed it — the unknown-tool roster, which must not name a tool
   * belonging to a skill the caller's policy hides — had no way to ask. A
   * consumer re-deriving it from `Agent.injections` would be a second walk of
   * the same arrays, which is the shape this release exists to remove.
   *
   * Shared references are kept whole: a Tool the same reference of which two
   * skills carry is listed under BOTH ids, so a reader can apply the
   * sole-owner rule (hide the name only when every declaring skill is hidden)
   * rather than guessing at ownership.
   *
   * EMPTY when no registered skill declares a tool. Static `.tool()`
   * registrations, `read_skill`, `present` and `skip_step` are never in it:
   * they are the framework's or the app's, not a skill's.
   */
  readonly toolDeclaringSkills: ReadonlyMap<string, readonly string[]>;
  /**
   * EVERY BUILD-TIME CLAIMANT PER TOOL NAME (9.92.0) — a list, not a winner.
   *
   * `registryByName` holds one implementation per name and still does: it is
   * the map dispatch falls back to for a name that is NOT on this epoch's
   * wire (a held-out step tool, a parked map's tool, a scoped tool named from
   * a restored transcript — the capability law's "a narrowing takes a name
   * off the wire, never out of dispatch", qualified since the 9.92.0 review
   * by "to the party the model last read it under"). What it cannot say is who ELSE
   * claimed the name, and that is what the tools slot needs to report a
   * dead claim (`tools.claim_swallowed`) and to name the wire's party
   * truthfully (`tools.shadowed`). Provider claims are not here — a
   * `ToolProvider` resolves per iteration and is a runtime fact.
   *
   * Order per name: the `augmentedRegistry` holder first (a static `.tool()`,
   * the framework's `read_skill`/`present`, an always-visible skill's tool),
   * then every other skill that declares the name (a shared reference is
   * listed under each declaring skill), then the framework's `skip_step` when
   * any skill declares steps. Build time decides nothing here: the wire
   * decides, per epoch, in `buildToolsSlot`.
   */
  readonly toolClaimants: ReadonlyMap<string, readonly ToolClaim[]>;
}

/** The build facts that gate auto-attached tools beyond skills (9.22.0). */
export interface BuildToolRegistryOptions {
  /**
   * Is an artifact store attached to this agent? Gates the `present`
   * auto-attach (the `read_skill` seam): true reserves the name and adds the
   * tool; false — the default — changes not one byte, so a storeless agent
   * may keep its own `present`.
   */
  readonly hasArtifactStore?: boolean;
}

/**
 * Compose the augmented tool registry from the static `.tool()`
 * registry + the agent's injections (skills only). Throws on tool-
 * name collisions across sources.
 */
export function buildToolRegistry(
  registry: readonly ToolRegistryEntry[],
  injections: readonly Injection[],
  options: BuildToolRegistryOptions = {},
): ToolRegistryArtifacts {
  const skills = injections.filter((i) => i.flavor === 'skill');

  // Collect skill tools, deduping by name when the SAME Tool reference
  // is shared across skills. Different Tool implementations under the
  // same name throws (already validated upstream by
  // validateToolNameUniqueness) — we keep the runtime check as
  // belt-and-suspenders.
  const skillToolEntries: ToolRegistryEntry[] = [];
  const sharedSkillTools = new Map<string, Tool>();
  // The declaration edge, recorded on the walk that already exists (9.86.0):
  // every skill that carries a name, not only the first one to claim it. The
  // `continue` below skips a repeat REGISTRATION, not a repeat declaration —
  // a shared Tool reference is genuinely declared by both skills, and a reader
  // asking "may this name be spoken?" needs both ids to answer.
  const declaringSkills = new Map<string, string[]>();
  // The claims (9.92.0), in the order the doc on `toolClaimants` states.
  const claims = new Map<string, ToolClaim[]>();
  const claim = (name: string, c: ToolClaim): void => {
    const held = claims.get(name);
    if (held === undefined) claims.set(name, [c]);
    else held.push(c);
  };
  const skillClaims: { readonly name: string; readonly claim: ToolClaim }[] = [];
  for (const skill of skills) {
    const meta = skill.metadata as { autoActivate?: string } | undefined;
    const isAutoActivate = meta?.autoActivate === 'currentSkill';
    const toolsFromSkill = skill.inject.tools ?? [];
    for (const tool of toolsFromSkill) {
      const name = tool.schema.name;
      const declared = declaringSkills.get(name);
      if (declared === undefined) declaringSkills.set(name, [skill.id]);
      else if (!declared.includes(skill.id)) declared.push(skill.id);
      skillClaims.push({
        name,
        claim: { channel: 'skill', id: skill.id, tool: tool as unknown as Tool },
      });
      // Check EVERY skill tool — including autoActivate ones, which `continue`
      // below and never reach the static registry's gate. (This is the common
      // case: all of Neo's skills are autoActivate, so their scoped tools would
      // otherwise skip the check entirely.) Dev-mode warn only — non-breaking.
      warnIfInvalidToolName(name);
      const existing = sharedSkillTools.get(name);
      if (existing) {
        if (existing !== (tool as unknown as Tool)) {
          throw new Error(
            `Agent: tool name '${name}' is declared by multiple skills with different ` +
              `Tool implementations. Skills MAY share the SAME Tool reference; they may ` +
              `NOT register different functions under the same name.`,
          );
        }
        continue; // dedupe — same reference already added
      }
      sharedSkillTools.set(name, tool as unknown as Tool);
      // autoActivate skills: their tools come ONLY through dynamicSchemas
      // (buildToolsSlot.ts pulls them from activeInjections.inject.tools
      // when the skill is active). Don't pre-load in the static registry.
      //
      // Reaching this line means NOBODY asked for the tool to be scoped —
      // not the skill (`defineSkill({ autoActivate })`), not the graph
      // (`skillGraph({ scopeTools: true })`), not the agent
      // (`.toolsFromActiveSkill()`, 9.36.0, which stamps the same field on
      // every tool-carrying skill at build). All three write `autoActivate`
      // and this reads it, so there is one gate here, not three.
      if (isAutoActivate) continue;
      skillToolEntries.push({ name, tool });
    }
  }

  // buildReadSkillTool returns undefined when skills is empty; the length
  // check left of the ternary short-circuits so the non-null assertion is safe.
  const readSkillEntries: readonly ToolRegistryEntry[] =
    skills.length > 0
      ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        [{ name: 'read_skill', tool: buildReadSkillTool(skills)! }]
      : [];

  // ── `present` — the hand-to-the-screen tool (9.22.0) ────────────────
  // Auto-attached as a FULL citizen (schema offered + dispatchable) ONLY
  // when a store is attached — the read_skill seam. The name is reserved
  // the moment the store is: a consumer tool already holding 'present'
  // would silently win the dispatch map and the model's presentations
  // would run somebody else's function — accepted-and-silently-wrong, so
  // it is refused by name (the skip_step law). Without a store, nothing
  // here runs and a consumer's own 'present' is nobody's business.
  const presentEntries: readonly ToolRegistryEntry[] = [];
  if (options.hasArtifactStore === true) {
    const holders = [
      ...registry.map((e) => e.name),
      ...skillToolEntries.map((e) => e.name),
      ...sharedSkillTools.keys(),
    ];
    if (holders.includes(PRESENT_TOOL_NAME)) {
      throw new Error(
        `Agent: tool name '${PRESENT_TOOL_NAME}' is reserved when an artifact store is ` +
          `attached — the framework auto-attaches the hand-to-the-screen tool under that ` +
          `name, and a same-named tool would silently take over the model's presentations. ` +
          `Rename your tool, or drop the \`artifacts\` store.`,
      );
    }
    (presentEntries as ToolRegistryEntry[]).push({
      name: PRESENT_TOOL_NAME,
      tool: buildPresentTool(),
    });
  }

  const augmentedRegistry: readonly ToolRegistryEntry[] = [
    ...registry,
    ...readSkillEntries,
    ...presentEntries,
    ...skillToolEntries,
  ];

  // Final cross-source name-uniqueness check: static .tool() vs
  // read_skill vs (deduped) skill tools. Catches collisions BETWEEN
  // sources (e.g., a static .tool('foo') colliding with a Skill's foo).
  const seenNames = new Set<string>();
  for (const entry of augmentedRegistry) {
    // Charset check at the array boundary: EVERY tool name the LLM will see — from
    // .tool()/.tools() arrays, read_skill, and every skill's tools:[] bundle — is
    // checked here, so a raw `{schema,execute}` literal that bypassed defineTool is
    // caught too. A bad name 400-rejects the whole provider request (all tools
    // vanish); dev-mode warn flags it at build, naming the offending tool.
    warnIfInvalidToolName(entry.name);
    if (seenNames.has(entry.name)) {
      throw new Error(
        `Agent: duplicate tool name '${entry.name}'. Tool names must be unique ` +
          `across .tool() registrations and Skills' inject.tools (after deduping ` +
          `same-reference shares across skills). The LLM dispatches by name; ` +
          `collisions break tool routing.`,
      );
    }
    seenNames.add(entry.name);
  }

  // Claims, in `toolClaimants` order: the augmentedRegistry holders first
  // (registry, read_skill, present — every always-visible skill tool is a
  // skill claim and lands in the next loop, in declaration order, which is
  // the order `skillToolEntries` was pushed in), then every skill claim.
  for (const e of registry) {
    claim(e.name, {
      channel: 'registry',
      ...(e.tool.owner && { id: e.tool.owner.id }),
      tool: e.tool,
    });
  }
  for (const e of [...readSkillEntries, ...presentEntries]) {
    claim(e.name, { channel: 'framework', tool: e.tool });
  }
  for (const { name, claim: c } of skillClaims) claim(name, c);

  const registryByName = new Map<string, Tool>(
    augmentedRegistry.map((e) => [e.name, e.tool] as const),
  );
  // autoActivate skill tools live outside augmentedRegistry but MUST
  // be findable by name at dispatch time. Add them to the dispatch
  // map so `lookupTool` resolves correctly when the skill activates.
  for (const [name, tool] of sharedSkillTools.entries()) {
    if (!registryByName.has(name)) {
      registryByName.set(name, tool);
    }
  }
  // ── skip_step — the procedure-integrity tool (9.18.0) ───────────────
  // Auto-attached to the DISPATCH map when ≥1 registered skill declares
  // `steps` (the read_skill auto-attach seam) — always dispatchable, but
  // deliberately NOT in `augmentedRegistry`/`toolSchemas`: the tools slot
  // OFFERS its schema only while a stepped tenure is active and unfinished
  // (the autoActivate dispatch-vs-offer split, one map up). With no stepped
  // skill nothing here runs — no reserved name, no map entry, no delta.
  //
  // The name is reserved the moment steps exist: a consumer tool (or a
  // skill tool) already holding 'skip_step' would silently WIN the dispatch
  // map and the model's recorded skips would run somebody else's function —
  // accepted-and-silently-wrong, so it is refused by name instead.
  const hasSteps = injections.some((i) => i.flavor === 'skill' && stepsOf(i) !== undefined);
  if (hasSteps) {
    if (registryByName.has(SKIP_STEP_TOOL_NAME)) {
      throw new Error(
        `Agent: tool name '${SKIP_STEP_TOOL_NAME}' is reserved when any skill declares ` +
          `\`steps\` — the framework auto-attaches the procedure-integrity tool under that ` +
          `name, and a same-named tool would silently take over the model's recorded skips. ` +
          `Rename your tool.`,
      );
    }
    const skipStep = buildSkipStepTool();
    registryByName.set(SKIP_STEP_TOOL_NAME, skipStep);
    // The framework's own claim (9.92.0): a claimant like any other. It wins
    // the wire only when no other party puts the name forward that epoch —
    // the tools slot merges its schema LAST — and when a provider does, the
    // provider's contract is what the model reads and the provider's tool is
    // what answers; the procedure does not advance on a call whose contract
    // the model read from somebody else (recorded-not-built, entry 3).
    claim(SKIP_STEP_TOOL_NAME, { channel: 'framework', tool: skipStep });
  }
  const toolSchemas = augmentedRegistry.map((e) => e.tool.schema);

  return {
    augmentedRegistry,
    registryByName,
    toolSchemas,
    toolDeclaringSkills: declaringSkills,
    toolClaimants: claims,
  };
}
