/**
 * toolResolver — the ONE answer to "which implementation answers this name on
 * this call", lifted out of the dispatch loop so every reader that must agree
 * with dispatch asks the same function.
 *
 * Pattern: a deps-closure factory (the `toolDispatch.ts` shape). Pure over the
 *          reference holders it is handed — the tools slot's per-epoch records
 *          (`servedTools`, `providerToolCache`) are shared by REFERENCE, so a
 *          resolver built once answers for the current epoch whenever it runs.
 * Role:    core/agent. Two readers: `stages/toolCalls/execution/catalogOperations.ts` (dispatch, and the
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

import type { ToolProvider } from '../../../tools/toolProvider.js';
import type { ProviderToolCache, ServedToolParties } from '../../slots/buildToolsSlot.js';
import { sameToolParty, type ToolParty } from '../../../tools/toolParty.js';
import type { Tool } from '../../../tools/tools.js';
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

/** The declaration currently labeling the provider, not its implementation identity. */
function providerPartyOf(deps: ToolResolverDeps): ToolParty {
  const id = deps.externalToolProvider?.id;
  return { channel: 'provider', ...(id !== undefined && { id }) };
}

function providerToolOf(deps: ToolResolverDeps, name: string): Tool | undefined {
  return deps.externalToolProvider
    ? (deps.providerToolCache?.current ?? []).find((tool) => tool.schema.name === name)
    : undefined;
}

/** Every bound path asks the same current-owner policy; a mismatch never falls through. */
function toolForParty(deps: ToolResolverDeps, name: string, party: ToolParty): Tool | undefined {
  if (party.channel === 'provider') {
    return deps.externalToolProvider && sameToolParty(party, providerPartyOf(deps))
      ? providerToolOf(deps, name)
      : undefined;
  }
  const tool = deps.registryByName.get(name);
  if (tool === undefined) return undefined;
  const claims = deps.toolClaimants?.get(name);
  const matches =
    claims !== undefined && claims.length > 0
      ? claims.some((claim) => claim.tool === tool && sameToolParty(claim, party))
      : sameToolParty(party, { channel: 'registry' });
  return matches ? tool : undefined;
}

/** A name with no prior party still reports the declaration of its actual current holder. */
function registryPartyOf(deps: ToolResolverDeps, name: string): ToolParty | undefined {
  const claims = deps.toolClaimants?.get(name);
  if (claims === undefined || claims.length === 0) return { channel: 'registry' };
  const tool = deps.registryByName.get(name);
  const claim = claims.find((candidate) => candidate.tool === tool);
  return claim === undefined
    ? undefined
    : { channel: claim.channel, ...(claim.id !== undefined && { id: claim.id }) };
}

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
  return (toolName, pinned) => {
    const wireParty = pinned ?? deps.servedTools?.current.get(toolName);
    if (wireParty === null) return { refusal: deps.notServed(toolName) };
    const lastParty =
      wireParty === undefined ? deps.servedTools?.lastServed.get(toolName) : undefined;
    const party = wireParty ?? lastParty;
    if (party !== undefined) {
      const tool = toolForParty(deps, toolName, party);
      return tool === undefined
        ? { party, refusal: deps.notServed(toolName) }
        : { tool, party, ...(lastParty !== undefined && { offWire: true as const }) };
    }
    const registryHolder = deps.registryByName.get(toolName);
    const providerHolder = providerToolOf(deps, toolName);
    const tool = registryHolder ?? providerHolder;
    if (tool === undefined) return {};
    if (registryHolder !== undefined && providerHolder !== undefined) {
      return { refusal: deps.notServed(toolName) };
    }
    const currentParty =
      registryHolder === undefined ? providerPartyOf(deps) : registryPartyOf(deps, toolName);
    return currentParty === undefined
      ? { refusal: deps.notServed(toolName) }
      : { tool, party: currentParty, offWire: true };
  };
}
