/**
 * Skill-body ↔ tool-contract consistency check (Proposal 009, Tier 1).
 *
 * A skill's `body` (prose injected into the system prompt) can quietly contradict
 * the tools it actually unlocks, and the model then **refuses a tool that is right
 * there** — or is told about one it can't call. The library already knows each
 * skill's real tool set (`inject.tools`), so it can flag the mismatch at authoring
 * time instead of at run time.
 *
 * Tier 1 is DETERMINISTIC (no LLM): pure string + schema checks. The semantic
 * contradictions it can't see — e.g. "the body calls an OPTIONAL arg required" —
 * are Tier 2 (LLM-advisory, opt-in). Both checks here are WARNINGS, never errors:
 * a body naming a foreign tool is often an intentional `read_skill` handoff hint.
 */

import type { Injection } from './types.js';
import type { GraphProblem } from './skillGraphCheckup.js';

/** A snake_case token immediately followed by `(` — looks like a tool call in prose. */
const TOOL_CALL_RE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*\(/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The tool names a skill unlocks (`inject.tools[].schema.name`). */
export function skillToolNames(skill: Injection): readonly string[] {
  const tools = (skill as { inject?: { tools?: readonly { schema: { name: string } }[] } }).inject
    ?.tools;
  return tools ? tools.map((t) => t.schema.name) : [];
}

/**
 * Check ONE skill's body against its tool contract. Pure + side-effect-free.
 *
 * @param skill           the skill to check
 * @param knownToolNames  every tool name reachable in the wider graph/agent (lets
 *                        the check tell a cross-skill HANDOFF from a typo). Omit to
 *                        check a skill in isolation (only its own tools are "known").
 */
export function checkSkillContract(
  skill: Injection,
  knownToolNames?: ReadonlySet<string>,
): GraphProblem[] {
  const id = (skill as { id: string }).id;
  const body = (skill as { inject?: { systemPrompt?: string } }).inject?.systemPrompt ?? '';
  if (body.length === 0) return [];

  const own = new Set(skillToolNames(skill));
  const known = knownToolNames ?? own;
  const problems: GraphProblem[] = [];

  // 1. body-foreign-tool — the body names a tool that is real (exists somewhere in
  //    the graph) but NOT in this skill's tools[]: the model is told about a tool it
  //    cannot call on this turn. Usually a `read_skill` handoff hint — confirm, or
  //    add the tool / reword. Word-boundary match (tool names are distinctive).
  for (const name of known) {
    if (own.has(name)) continue;
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(body)) {
      problems.push({
        kind: 'warning',
        code: 'body-foreign-tool',
        message:
          `Skill "${id}" body mentions tool "${name}", which is not in its tools[] ` +
          `(it belongs to another skill). The model is told about a tool it can't call here — ` +
          `make it an explicit read_skill handoff, add the tool to this skill, or reword.`,
        skill: id,
      });
    }
  }

  // 2. body-unknown-tool — the body has a `tool_name(` call-style reference whose name
  //    is no known tool anywhere: a typo or a hallucinated/renamed tool. Conservative:
  //    only snake_case-with-`(` tokens count, and only when truly unknown.
  const seen = new Set<string>();
  for (const m of body.matchAll(TOOL_CALL_RE)) {
    const name = m[1];
    if (seen.has(name) || own.has(name) || known.has(name)) continue;
    seen.add(name);
    problems.push({
      kind: 'warning',
      code: 'body-unknown-tool',
      message:
        `Skill "${id}" body references "${name}(…)", but no tool named "${name}" exists ` +
        `(in this skill or the graph). Likely a typo or a renamed/removed tool — the model ` +
        `will try to call a tool that isn't there.`,
      skill: id,
    });
  }

  return problems;
}

/** Run the contract check across many skills with a shared known-tool set. Pure. */
export function checkSkillContracts(skills: readonly Injection[]): GraphProblem[] {
  const known = new Set<string>();
  for (const s of skills) for (const n of skillToolNames(s)) known.add(n);
  return skills.flatMap((s) => checkSkillContract(s, known));
}
