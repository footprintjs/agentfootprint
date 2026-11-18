import type { ToolRegistryEntry } from '../../../../tools/tools.js';
import type { Injection } from '../../../../injection-engine/types.js';
import type { ToolProvider } from '../../../../tools/toolProvider.js';

/**
 * Refuse `.checkIn({...})` on an agent where no tool can ever trip the gate (8.13.0).
 *
 * `.checkIn()` configures HOW the ask is assembled — the evidence preset, the
 * drivers scorer. What MAKES an ask is a tool declaring `checkIn`. Resolution
 * already defaults (standard evidence + the lexical scorer), so a declaring tool
 * works with no `.checkIn()` call at all; the reverse — `.checkIn()` with nothing
 * that declares — configures the shape of a question that is never asked.
 *
 * Scans BOTH sources the dispatch map is built from (`buildToolRegistry`): the
 * `.tool()` registry and every skill's `inject.tools`, since a skill tool with a
 * `checkIn` demand is a real gate.
 *
 * NOT refused when a `.toolProvider()` is wired. Its tools are resolved per
 * iteration and may declare `checkIn`; build time cannot know, and refusing what
 * it cannot know would break a correct agent.
 */
function assertCheckInHasADeclaringTool(
  configured: boolean,
  registry: readonly ToolRegistryEntry[],
  injections: readonly Injection[],
  toolProvider: ToolProvider | undefined,
): void {
  if (!configured || toolProvider !== undefined) return;
  const declares = (tool: { readonly checkIn?: unknown }): boolean => tool.checkIn !== undefined;
  if (registry.some((entry) => declares(entry.tool))) return;
  for (const injection of injections) {
    for (const tool of injection.inject?.tools ?? []) {
      if (declares(tool as { readonly checkIn?: unknown })) return;
    }
  }
  throw new Error(
    'AgentBuilder.checkIn: configured, but no registered tool declares `checkIn` — so the gate ' +
      'is never consulted, this agent will never pause for consent, and the evidence settings ' +
      'here decide nothing. `.checkIn()` configures HOW the ask is assembled; a tool declaring ' +
      "`checkIn: 'always'` (or a predicate) is what MAKES the ask. Add it to the tool that " +
      "needs consent — defineTool({ …, checkIn: 'always' }) — or drop `.checkIn()`.",
  );
}

export { assertCheckInHasADeclaringTool };
