/** Component-owned declarations, paired with actual native catalog implementations. */
import type { Tool } from '../../../tools/tools.js';
import type { ToolParty } from '../../../tools/toolParty.js';
import { resultRowsetsOf, type ToolResultRowset } from '../../../tools/resultRowsets.js';
import type { ToolResolver } from '../stages/toolResolver.js';

export interface ResultRowsetCatalog {
  readonly declarations: ReadonlyMap<string, readonly ToolResultRowset[]>;
  readonly get: (tool: Tool) => readonly ToolResultRowset[] | undefined;
}

/** Snapshot only inert metadata; preserve class/private-field/this-backed Tool identity. */
export function resultRowsetCatalog(
  entries: Iterable<readonly [string, Tool]>,
): ResultRowsetCatalog {
  const held = new WeakMap<Tool, readonly ToolResultRowset[] | undefined>();
  const declarations = new Map<string, readonly ToolResultRowset[]>();
  for (const [name, tool] of entries) {
    if (!held.has(tool)) held.set(tool, resultRowsetsOf(name, tool, tool.resultColumns));
    const rowsets = held.get(tool);
    if (rowsets !== undefined && !declarations.has(name)) declarations.set(name, rowsets);
  }
  return Object.freeze({ declarations, get: (tool: Tool) => held.get(tool) });
}

// The key is the private native component's cache holder, never a shared Tool.
// Each successful list replaces this acquisition's snapshot; failed discovery
// clears it together with the executable catalog. Old invocations retain only
// the frozen declarations they already captured before dispatch awaits.
const providerCatalogs = new WeakMap<object, ResultRowsetCatalog>();
export function clearProviderRowsets(cache: object): void {
  providerCatalogs.delete(cache);
}
export function holdProviderRowsets(cache: object, catalog: ResultRowsetCatalog): void {
  providerCatalogs.set(cache, catalog);
}

/** Read the same current/pinned party as dispatch, then the exact Tool's held metadata. */
export function resultRowsetsReader(
  registered: ResultRowsetCatalog,
  providerCache: object,
  resolve: ToolResolver,
): (toolName: string, tool: Tool, party?: ToolParty) => readonly ToolResultRowset[] | undefined {
  return (toolName, tool, party) => {
    const current = resolve(toolName, party);
    if (current.tool !== tool) return undefined;
    const catalog =
      current.party?.channel === 'provider' ? providerCatalogs.get(providerCache) : registered;
    return catalog?.get(tool);
  };
}

/** Resolve only names in the current response, not the whole provider catalog. */
export function declaringRowsetTools(
  registered: ResultRowsetCatalog,
  providerCache: object,
  resolve: ToolResolver,
  names: Iterable<string>,
): ReadonlySet<string> {
  const declaring = new Set<string>();
  for (const name of new Set(names)) {
    const current = resolve(name);
    const catalog =
      current.party?.channel === 'provider' ? providerCatalogs.get(providerCache) : registered;
    if (current.tool !== undefined && catalog?.get(current.tool) !== undefined) declaring.add(name);
  }
  return declaring;
}
