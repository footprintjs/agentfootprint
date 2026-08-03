/**
 * delivery/rules — where a delivered injection may go, and whether it is
 * already there.
 *
 * Pattern: Pure functions over the window (no scope, no I/O, no provider).
 * Role:    core/ layer. The counterpart to `window/turns.ts`: that module
 *          decides what may LEAVE the window, this one decides what may
 *          ENTER it. Both answer with a refusal that names itself, and both
 *          exist so the rule lives in exactly one place instead of being
 *          re-derived at each call site.
 * Emits:   N/A.
 *
 * ── The one rule worth arguing about ─────────────────────────────────
 * Collision is judged on the EFFECTIVE wire role, where `'tool'` counts as
 * `'user'`. That is deliberately more conservative than any single provider
 * requires: Anthropic coalesces `tool_result`s into a user turn (so a user
 * message after tool results breaks its strict alternation), while OpenAI
 * keeps `role: 'tool'` and would accept one. Judging per-provider would make
 * the SAME declaration deliver on one wire and defer on another, with
 * nothing in the recording to tell them apart — which is the exact
 * provider-dependent truth this whole feature exists to avoid. So the floor
 * is the rule, uniformly.
 *
 * The consequence is real and stated rather than hidden: inside a tool-using
 * agent loop the window ends on the user's turn (iteration 1) or on tool
 * results (every iteration after), so a `'user'`-role injection typically
 * never gets a slot. `'assistant'` does, and `'system'` does on the providers
 * that carry it.
 *
 * Testable on its own — see `test/core/delivery/delivery-rules.test.ts`.
 */

import type { LLMMessage, WireRole } from '../../../adapters/types.js';
import { fnv1a } from '../../slots/helpers.js';
import type { DeferralReason } from '../../../lib/injection-engine/messagesSlotRefusal.js';

/**
 * The role a message OCCUPIES on the wire, for sequencing purposes.
 *
 * A `tool` message is folded into `user` because that is what the strictest
 * provider does with it. Everything else is itself.
 */
export function effectiveWireRole(role: LLMMessage['role']): WireRole {
  return role === 'tool' ? 'user' : role;
}

/**
 * The stable identity of one deliverable message: who declared it, and what
 * it says.
 *
 * Position within the injection's own list is deliberately NOT part of the
 * key — it cannot be recovered from a message already sitting in the window,
 * and the key has to mean the same thing whether it is read from the run's
 * ledger or recovered from a marker on a restored history. Content identity
 * is what matters: a memory recall whose text changed between iterations is a
 * NEW delivery (it is new content), an always-on fact repeating verbatim is
 * the same one and is delivered once, and one injection declaring the same
 * sentence twice says it once.
 */
export function deliveryKey(injectionId: string, role: string, content: string): string {
  return `${injectionId}:${fnv1a(`${role}:${content}`)}`;
}

/**
 * Every delivery key already present as a marker in the window.
 *
 * Unioned with the run's ledger before deciding what to deliver, and that
 * union is what makes replay safe: `agent.resumeOnError` rebuilds the
 * conversation but starts a fresh scope, so the ledger is empty while the
 * delivered messages are right there in the restored history. Reading the
 * window itself is the only way to know that.
 */
export function keysInWindow(history: readonly LLMMessage[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const msg of history) {
    const by = msg.injectedBy;
    if (by === undefined) continue;
    keys.add(deliveryKey(by.injectionId, msg.role, msg.content));
  }
  return keys;
}

/**
 * Why a message may NOT be appended to the end of `history` right now, or
 * `undefined` when it may.
 *
 * Two refusals, in the order a reader cares about them:
 *   • `unanswered-tool-call` — the tail is an assistant turn whose tool calls
 *     have no results yet. Appending here would sit BETWEEN a `tool_use` and
 *     its `tool_result`, which is the one split the window family refuses in
 *     the other direction too.
 *   • `role-collision` — the turn at the end already speaks in this effective
 *     role, and providers reject two in a row.
 */
export function refusalForPlacement(
  history: readonly LLMMessage[],
  role: WireRole,
): DeferralReason | undefined {
  if (history.length === 0) return undefined;
  const answered = new Set<string>();
  for (const msg of history) {
    if (msg.role === 'tool' && msg.toolCallId) answered.add(msg.toolCallId);
  }
  for (const msg of history) {
    for (const call of msg.toolCalls ?? []) {
      if (!answered.has(call.id)) return 'unanswered-tool-call';
    }
  }
  const tail = history[history.length - 1]!;
  if (effectiveWireRole(tail.role) === effectiveWireRole(role)) return 'role-collision';
  return undefined;
}

/** The effective role of the turn a delivery would land behind, for the note. */
export function tailWireRole(history: readonly LLMMessage[]): WireRole | undefined {
  const tail = history[history.length - 1];
  return tail === undefined ? undefined : effectiveWireRole(tail.role);
}
