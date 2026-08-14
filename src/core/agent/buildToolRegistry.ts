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
 */

import { buildReadSkillTool, buildSkipStepTool } from '../../lib/injection-engine/skillTools.js';
import { stepsOf, SKIP_STEP_TOOL_NAME } from '../../lib/injection-engine/skillSteps.js';
import type { Injection } from '../../lib/injection-engine/types.js';
import type { LLMToolSchema } from '../../adapters/types.js';
import { PRESENT_TOOL_NAME } from '../../artifacts/present.js';
import { buildPresentTool } from './presentTool.js';
import { warnIfInvalidToolName, type Tool, type ToolRegistryEntry } from '../tools.js';

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
  for (const skill of skills) {
    const meta = skill.metadata as { autoActivate?: string } | undefined;
    const isAutoActivate = meta?.autoActivate === 'currentSkill';
    const toolsFromSkill = skill.inject.tools ?? [];
    for (const tool of toolsFromSkill) {
      const name = tool.schema.name;
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
    registryByName.set(SKIP_STEP_TOOL_NAME, buildSkipStepTool());
  }
  const toolSchemas = augmentedRegistry.map((e) => e.tool.schema);

  return { augmentedRegistry, registryByName, toolSchemas };
}
