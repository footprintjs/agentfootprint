/**
 * searchOf — the ONE door to a tool's `search`, judged once per tool object.
 *
 * Pattern: a WeakMap-cached verdict (the `hostFilled` declaration precedent).
 * Role:    tools/ layer. Read by the agent's registration funnel
 *          (`core/agent/buildToolRegistry.ts`, so a static tool is judged at
 *          build) and by the dispatch funnel (`core/agent/stages/
 *          searchCoverage.ts`, so a provider's tool is judged when first
 *          met). Composition never reads `tool.search` directly.
 * Emits:   one console warning per refused tool object (not dev-gated: a
 *          refused declaration is a rail that does not arm, and its symptom is
 *          silence — the `toolExtras` rule).
 *
 * `defineTool` and the MCP ingest door judge a declaration, but a hand-built
 * `Tool` handed to `.tool()` skips both. So the verdict is taken HERE, by the
 * same rule (`assertToolSearch`, against the tool's own `inputSchema` and the
 * arguments its `period` names), and the accepted declaration is stored
 * frozen (`freezeSearch`). A `defineTool` tool is remembered as built, never
 * judged twice; a `hostFilled` wrapper keeps the verdict on the tool it wraps
 * (its schema no longer lists the filled arguments the search classifies).
 *
 * A REFUSED declaration composes nothing — not a `'remote'` row. A remote row
 * is a well-formed declaration the library does not trust; a refused one has
 * no shape any rule vetted, so no facet may be composed from it. Its
 * `checked: 'declared'` literal becomes the call's error, naming the fault.
 */

import {
  assertToolSearch,
  freezeSearch,
  periodArgumentsOf,
} from '../semantics/coverage/search/declaration.js';
import type { ToolSearch } from '../semantics/coverage/search/types.js';
import type { Tool } from './tools.js';

/** The verdict on one tool's declaration: accepted (frozen), refused (why), or none. */
export interface SearchVerdict {
  readonly search?: ToolSearch;
  readonly problem?: string;
}

const VERDICTS = new WeakMap<object, SearchVerdict>();

/** Tool names already warned about — bounded, like every warn-once ledger fed by callers. */
const warned = new Set<string>();
const MAX_WARNED = 500;

function warnRefused(toolName: string, problem: string): void {
  if (warned.has(toolName)) return;
  if (warned.size < MAX_WARNED) warned.add(toolName);
  // eslint-disable-next-line no-console
  console.warn(
    `[agentfootprint] tool '${toolName}' carries a \`search\` this library refused, so ` +
      'nothing is composed for its calls and its checked: "declared" results are refused. ' +
      `The rule it broke: ${problem}`,
  );
}

/**
 * Remember a declaration already judged and frozen — `defineTool` calls it for
 * the tool it builds. @internal
 */
export function rememberSearch(tool: object, search: ToolSearch): void {
  VERDICTS.set(tool, { search });
}

/**
 * Carry `from`'s verdict to `to` — a wrapper whose schema changed (`hostFilled`)
 * keeps the verdict taken against the schema the search was declared for.
 * @internal
 */
export function inheritSearch(from: Tool, to: object): void {
  VERDICTS.set(to, searchOf(from));
}

/**
 * The tool's accepted `search`, or why it was refused, or `{}` when it
 * declares none. Judged on first sight of a tool object, then remembered.
 *
 * @example
 * ```ts
 * const { search, problem } = searchOf(tool);
 * if (search === undefined) return; // nothing to compose
 * ```
 */
export function searchOf(tool: Tool): SearchVerdict {
  if (tool.search === undefined) return {};
  const known = VERDICTS.get(tool);
  if (known !== undefined) return known;
  let verdict: SearchVerdict;
  try {
    const periodArguments = periodArgumentsOf(tool.period);
    assertToolSearch(tool.schema.name, tool.search, {
      inputSchema: tool.schema.inputSchema ?? { type: 'object', properties: {} },
      ...(periodArguments !== undefined && { periodArguments }),
    });
    verdict = { search: freezeSearch(tool.search) };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    warnRefused(tool.schema.name, problem);
    verdict = { problem };
  }
  VERDICTS.set(tool, verdict);
  return verdict;
}

/**
 * Forget every warning issued so far.
 * @internal test seam — the ledger is process-wide and warn-ONCE.
 */
export function _resetSearchOfWarnings(): void {
  warned.clear();
}
