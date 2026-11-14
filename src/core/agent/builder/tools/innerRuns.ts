import { innerRunsOf, mergeInnerRuns, type InnerRunLookup } from '../../../innerRunRecords.js';
import type { ToolRegistryEntry } from '../../../../tools/tools.js';
import type { Injection } from '../../../../injection-engine/types.js';

/**
 * Gather the inner-run stores of every tool that keeps one (8.17.0).
 *
 * A `flowchartAsTool({ keepRecord: true })` carries its store on the tool
 * object under a registry symbol. This finds them so `.selfExplain()` can
 * hand one merged lookup to the trace artifacts — the consumer wires
 * nothing; mounting the tool and calling `.selfExplain()` is the whole
 * configuration.
 *
 * Two sources, both known at build time: the static registry (`.tool()` /
 * `.tools()`) and skill-declared tools. A tool arriving from a
 * `.toolProvider()` is deliberately NOT collected — provider tools are
 * resolved per iteration against a live context, so there is no build-time
 * moment at which the list exists. `inspect_tool_run` then answers with the
 * honest-absence arm, which names `keepRecord`; a consumer in that position
 * should register the chart tool statically as well.
 */
function collectInnerRuns(
  registry: readonly ToolRegistryEntry[],
  injections: readonly Injection[],
): InnerRunLookup | undefined {
  const found: InnerRunLookup[] = [];
  const take = (candidate: unknown): void => {
    const store = innerRunsOf(candidate);
    if (store !== undefined && !found.includes(store)) found.push(store);
  };
  for (const entry of registry) take(entry.tool);
  for (const injection of injections) {
    for (const tool of injection.inject?.tools ?? []) take(tool);
  }
  return mergeInnerRuns(found);
}

export { collectInnerRuns };
