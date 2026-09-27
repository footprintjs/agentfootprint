/**
 * toolResolver — the ONE answer to "which implementation answers this name on
 * this call", lifted out of the dispatch loop so every reader that must agree
 * with dispatch asks the same function.
 *
 * Pattern: a deps-closure factory (the `toolDispatch.ts` shape). Pure over the
 *          reference holders it is handed — the tools slot's per-epoch records
 *          (`servedTools`, `providerToolCache`) are shared by REFERENCE, so a
 *          resolver built once answers for the current epoch whenever it runs.
 * Role:    core/agent. Two readers: `stages/toolCalls.ts` (dispatch, and the
 *          four resume doors) and the inputs layer (`honesty/mounts.ts`), which
 *          reads a call's argument rules off the implementation that WILL run
 *          — never off a re-derivation that could name a different party.
 *
 * Dispatch resolution order (9.92.0 — DISPATCH FOLLOWS THE OFFER):
 *   0. A name on THIS epoch's wire resolves to the party whose contract the
 *      model read (`servedTools`, written by the tools slot from the same
 *      merge that built the wire): a provider's schema → the provider's tool
 *      from `providerToolCache`; anything else → `registryByName`.
 *   1. A name NOT on the wire this epoch — held out by a step, a park or a
 *      scoping, or named from a restored transcript — resolves to the party
 *      the model LAST READ the name under (`lastServed`), or the name's only
 *      holder when it was never served this run. A name whose last-served party
 *      can no longer answer, or a never-served name held by two parties, is
 *      refused with `notServed(name)` rather than handed to a party the model
 *      was never shown under that name.
 */

import type { ToolProvider } from '../../../tool-providers/types.js';
import type {
  ProviderToolCache,
  ServedToolParties,
  ToolParty,
} from '../../slots/buildToolsSlot.js';
import type { Tool } from '../../tools.js';
import type { ToolClaim } from '../buildToolRegistry.js';

/** One name, resolved. */
export interface ToolResolution {
  readonly tool?: Tool;
  /** The party whose implementation answers. */
  readonly party?: ToolParty;
  /** The name was NOT on this epoch's wire and the fallback dispatched it. */
  readonly offWire?: true;
  /** Nothing may answer: the sentence the model reads. Absent with no
   *  `tool` means the name is unknown (`unknownToolResult`). */
  readonly refusal?: string;
}

/** What the resolver reads — the dispatch deps, by reference. */
export interface ToolResolverDeps {
  readonly registryByName: ReadonlyMap<string, Tool>;
  readonly externalToolProvider?: ToolProvider;
  readonly providerToolCache?: ProviderToolCache;
  readonly servedTools?: ServedToolParties;
  readonly toolClaimants?: ReadonlyMap<string, readonly ToolClaim[]>;
  /** The refusal a call reads when no party it was shown may answer. */
  readonly notServed: (toolName: string) => string;
}

/** `resolve(name, pinned?)` — `pinned` is a paused call's recorded party. */
export type ToolResolver = (toolName: string, pinned?: ToolParty) => ToolResolution;

/**
 * Build the resolver over the dispatch deps. Every reader that must agree with
 * dispatch builds it from the SAME deps objects, so the answers are the same.
 *
 * @example
 * ```ts
 * const resolve = buildToolResolver({ registryByName, notServed: notServedResult });
 * resolve('search_logs').tool; // the registered implementation
 * ```
 */
export function buildToolResolver(deps: ToolResolverDeps): ToolResolver {
  const { registryByName, externalToolProvider, providerToolCache, servedTools, toolClaimants } =
    deps;
  const fromProviderCache = (toolName: string): Tool | undefined =>
    externalToolProvider
      ? (providerToolCache?.current ?? []).find((t) => t.schema.name === toolName)
      : undefined;
  const providerParty: ToolParty = {
    channel: 'provider',
    ...(externalToolProvider?.id !== undefined && { id: externalToolProvider.id }),
  };
  /** The party a registry-routed name belongs to — its first build-time claimant. */
  const registryPartyOf = (toolName: string): ToolParty => {
    const first = toolClaimants?.get(toolName)?.[0];
    return first === undefined
      ? { channel: 'registry' }
      : { channel: first.channel, ...(first.id !== undefined && { id: first.id }) };
  };
  return (toolName, pinned) => {
    const wireParty = pinned ?? servedTools?.current.get(toolName);
    if (wireParty !== undefined) {
      const owner =
        wireParty.channel === 'provider'
          ? fromProviderCache(toolName)
          : registryByName.get(toolName);
      return owner !== undefined
        ? { tool: owner, party: wireParty }
        : { refusal: deps.notServed(toolName) };
    }
    const registryHolder = registryByName.get(toolName);
    const providerHolder = fromProviderCache(toolName);
    if (registryHolder === undefined && providerHolder === undefined) return {};
    const last = servedTools?.lastServed.get(toolName);
    if (last !== undefined) {
      const owner = last.channel === 'provider' ? providerHolder : registryHolder;
      return owner !== undefined
        ? { tool: owner, party: last, offWire: true }
        : { refusal: deps.notServed(toolName) };
    }
    if (registryHolder !== undefined && providerHolder !== undefined) {
      return { refusal: deps.notServed(toolName) };
    }
    return registryHolder !== undefined
      ? { tool: registryHolder, party: registryPartyOf(toolName), offWire: true }
      : // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        { tool: providerHolder!, party: providerParty, offWire: true };
  };
}
