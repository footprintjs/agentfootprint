import type { ToolDispatchContext, ToolGatePredicate, ToolProvider } from './toolProvider.js';
import type { Tool } from './tools.js';

/** Private discovery evidence. Retain the actual implementation until composition can match it. */
export interface LedgerOmission {
  readonly kind: 'ledger';
  readonly name: string;
  readonly tool: Tool;
}

type Listing = ToolProvider['list'];
interface InactiveSkill {
  readonly kind: 'skill-scope';
  readonly skillId: string;
  readonly tools: readonly Tool[];
}

export type ObserveSelection = (decision: LedgerOmission | InactiveSkill) => void;
type ObservedListing = (ctx: ToolDispatchContext, observe: ObserveSelection) => ReturnType<Listing>;

// A provider's label and arbitrary predicate properties cannot establish a ledger decision.
// Keep the witnesses off the public objects, including when providers are composed or replaced.
const ledgerGates = new WeakSet<ToolGatePredicate>();
const listings = new WeakMap<ToolProvider, { list: Listing; observed: ObservedListing }>();

export function ledgerPredicate(predicate: ToolGatePredicate): ToolGatePredicate {
  ledgerGates.add(predicate);
  return predicate;
}

export function registerLedgerListing(
  provider: ToolProvider,
  gate: ToolGatePredicate,
  observed: ObservedListing,
): void {
  if (ledgerGates.has(gate)) registerSelectionListing(provider, observed);
}

// Only built-in selection providers register their original method and its observed variant.
export function registerSelectionListing(provider: ToolProvider, observed: ObservedListing): void {
  listings.set(provider, { list: provider.list, observed });
}

/** An opaque provider gets its ordinary invocation. No observer passes through its boundary. */
export function listWithSelectionDecisions(
  provider: ToolProvider,
  ctx: ToolDispatchContext,
  observe: ObserveSelection,
): ReturnType<Listing> {
  const list = provider.list;
  const known = listings.get(provider);
  if (known && known.list === list) return known.observed(ctx, observe);
  return Reflect.apply(list, provider, [ctx]) as ReturnType<Listing>;
}
