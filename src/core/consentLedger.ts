import type { DecisionLedger } from './consentRequest.js';
import { armDeadline, linkedController, untilAborted } from '../lib/abort.js';

/** Membership capability for ledgers this library made, never duck-typed from isSpent. */
const MEMBERSHIP = Symbol.for('agentfootprint.consentLedger.membership.v1');
interface Membership {
  readonly spend: DecisionLedger['spend'];
  readonly read: (requestId: string) => boolean;
}
type Memberships = WeakMap<object, Membership>;
function memberships(): Memberships {
  const holder = globalThis as { [MEMBERSHIP]?: Memberships };
  const existing = holder[MEMBERSHIP];
  if (existing !== undefined) return existing;
  const made: Memberships = new WeakMap();
  Object.defineProperty(globalThis, MEMBERSHIP, { value: made });
  return made;
}

/**
 * A NEW {@link DecisionLedger} in this process's memory. Grows by one id per
 * answered request.
 *
 * Agents that name no ledger already share one of these per process, so this
 * is for a ledger of their own: agents given different ledgers spend
 * separately, and a decision spent in one is not known to the others.
 */
export function inMemoryDecisionLedger(): DecisionLedger {
  const spent = new Set<string>();
  const ledger: DecisionLedger = {
    spend(requestId) {
      if (spent.has(requestId)) return false;
      spent.add(requestId);
      return true;
    },
    isSpent: (requestId) => spent.has(requestId),
  };
  memberships().set(ledger, { spend: ledger.spend, read: (requestId) => spent.has(requestId) });
  return ledger;
}

/** Only an actual issued capability is definitive; an opaque positive boolean is not one. */
export function knownDecisionState(ledger: DecisionLedger, requestId: string): boolean | undefined {
  const issued = memberships().get(ledger);
  if (issued === undefined) return undefined;
  try {
    const current = Object.getOwnPropertyDescriptor(ledger, 'spend');
    return current !== undefined && 'value' in current && current.value === issued.spend
      ? issued.read(requestId)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An optional read after a failed spend is advisory and bounded. It may show
 * absence; it never authorizes a call or proves that a host closed one.
 */
export async function observeDecisionState(
  ledger: DecisionLedger,
  requestId: string,
  signal?: AbortSignal,
): Promise<boolean | undefined> {
  if (signal?.aborted === true) return undefined;
  const { controller, unlink } = linkedController(signal);
  const disarm = armDeadline(controller, 100, () => new Error('Decision observation timed out.'));
  try {
    const read = ledger.isSpent;
    if (typeof read !== 'function' || controller.signal.aborted) return undefined;
    const value = await untilAborted(read.call(ledger, requestId), controller.signal);
    if (controller.signal.aborted) return undefined;
    return value === true ? true : value === false ? false : undefined;
  } catch {
    return undefined;
  } finally {
    disarm();
    unlink();
  }
}

/** Actual local close acknowledgements only; bounded evidence, never execution authority. */
const CLOSE_PROOFS = Symbol.for('agentfootprint.consentLedger.localCloseProofs.v1');
const MAX_CLOSE_PROOFS = 1024;
function closeProofs(): Map<string, true> {
  const holder = globalThis as { [CLOSE_PROOFS]?: Map<string, true> };
  const existing = holder[CLOSE_PROOFS];
  if (existing !== undefined) return existing;
  const made = new Map<string, true>();
  Object.defineProperty(globalThis, CLOSE_PROOFS, { value: made });
  return made;
}
function proofKey(identity: string | undefined, requestId: string): string | undefined {
  if (
    typeof identity !== 'string' ||
    typeof requestId !== 'string' ||
    identity.length > 220 ||
    requestId.length !== 64
  )
    return undefined;
  return /^(?:store|process):[\s\S]+$/.test(identity) && /^[0-9a-f]{64}$/.test(requestId)
    ? JSON.stringify([identity, requestId])
    : undefined;
}

/** Called only after this process won the request and recorded its close marker. */
export function rememberLocalClose(identity: string | undefined, requestId: string): void {
  const key = proofKey(identity, requestId);
  if (key === undefined) return;
  const facts = closeProofs();
  facts.set(key, true);
  if (facts.size > MAX_CLOSE_PROOFS) {
    const oldest = facts.keys().next();
    if (!oldest.done) facts.delete(oldest.value);
  }
}

/** Eviction, restart, another identity or another request all mean unknown. */
export function hasLocalClose(identity: string | undefined, requestId: string): boolean {
  const key = proofKey(identity, requestId);
  return key !== undefined && closeProofs().has(key);
}
