/**
 * deliver — the stage that lets a `slot: 'messages'` injection into the window.
 *
 * Runs once per ReAct iteration, immediately after the Injection Engine has
 * decided what is active and BEFORE the three slots compose, so everything
 * downstream in the turn — the messages projection, the cache decision, and
 * the wire itself — sees the same past. The window law, from the entering
 * side: no component gets a different past than the model does.
 *
 * ── Why history, and not a splice at send time ───────────────────────
 * A delivered injection IS part of the conversation or it is a lie. Writing
 * it into `scope.history` (rather than into a parallel array the request
 * builder concatenates) is what makes every existing mechanism true of it
 * for free: the window strategies see it, count it and may fold it under the
 * standard refusal rules; the commit log records its arrival as a write by
 * THIS stage, so "who let it in" has an answer with a runtimeStageId on it;
 * `traceVariable` and the slices read it with no changes at all. The
 * alternative — a second list merged at the last moment — would have given
 * the model a past that no recorder in the library had ever seen.
 *
 * ── The three ways this stage says no ────────────────────────────────
 *  1. ROLE (D2, fatal) — the attached provider does not carry that role
 *     inside `messages`. Throws, naming the provider and what it carries.
 *     The statically-declared injections were already checked at run start;
 *     this catches what only appears at runtime (a hand-built memory-recall
 *     subflow formatting recall as a non-system role).
 *  2. PLACEMENT (D3, deferral) — the role would collide with the turn at the
 *     end of the window, or the tail is waiting on a tool result. Recorded on
 *     `messagesDelivery.deferred` with a sentence, and retried unchanged at
 *     the next boundary. Never dropped, never reordered.
 *  3. ALREADY THERE (dedupe) — this exact declaration has been delivered in
 *     this run. Deliberately silent: it is not a refusal, it is the absence
 *     of a second event.
 *
 * A deferral stops that INJECTION for the iteration, not the whole stage: a
 * later injection with a role that does fit still gets its slot. What it
 * cannot do is jump the one in front of it within its own message list —
 * order inside a declaration is the declaration's meaning.
 *
 * Writes (visible stage state — no new event contract; the per-slot route and
 * delta ride the same way):
 *   history               — the delivered messages, appended, marked
 *   messagesDelivery      — this iteration's delivered + deferred record
 *   deliveredMessageKeys  — the run's delivery ledger (dedupe)
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage, LLMProvider, WireRole } from '../../../adapters/types.js';
import { DEFAULT_CARRIES_IN_MESSAGES } from '../../../adapters/types.js';
import type { ActiveInjection } from '../../../lib/injection-engine/types.js';
import {
  messagesDeferralNote,
  messagesRoleRefusal,
} from '../../../lib/injection-engine/messagesSlotRefusal.js';
import { fnv1a } from '../../slots/helpers.js';
import { withMemoryRecall } from '../memoryRecallInjections.js';
import { deliveryKey, keysInWindow, refusalForPlacement, tailWireRole } from '../delivery/rules.js';
import type { DeferredMessage, DeliveredMessage } from '../delivery/types.js';
import type { AgentState } from '../types.js';

export interface DeliverStageDeps {
  /** The attached provider — the authority on what the wire can carry. */
  readonly provider: LLMProvider;
  /** Memory ids whose recall composes into the active set, exactly as the
   *  slots compose it (so the stage and the slots agree on what is active). */
  readonly memoryIds: readonly string[];
}

/** What a provider carries inside `messages`, with the floor applied. */
export function carriedRoles(provider: LLMProvider): readonly WireRole[] {
  return provider.carriesInMessages ?? DEFAULT_CARRIES_IN_MESSAGES;
}

/** Build the delivery stage. */
export function buildDeliverStage(deps: DeliverStageDeps): (scope: TypedScope<AgentState>) => void {
  const carries = carriedRoles(deps.provider);
  const carriesSet = new Set<WireRole>(carries);

  return (scope) => {
    const active = withMemoryRecall(
      scope.activeInjections as readonly ActiveInjection[] | undefined,
      scope as unknown as Record<string, unknown>,
      deps.memoryIds,
    );
    const iteration = (scope.iteration as number | undefined) ?? 1;

    // Materialise the window: `history` is a reactive proxy reference, and
    // this stage appends to it.
    const history = ((scope.history as readonly LLMMessage[] | undefined) ?? []).slice();
    const incoming = (scope.deliveredMessageKeys as readonly string[] | undefined) ?? [];
    const ledger = new Set<string>(incoming);
    // The union that makes replay safe — see `keysInWindow`.
    for (const key of keysInWindow(history)) ledger.add(key);

    const delivered: DeliveredMessage[] = [];
    const deferred: DeferredMessage[] = [];

    for (const inj of active) {
      const messages = inj.inject.messages ?? [];
      for (const msg of messages) {
        const key = deliveryKey(inj.id, msg.role, msg.content);
        if (ledger.has(key)) continue;

        const role = msg.role as WireRole;
        if (!carriesSet.has(role)) {
          // Fatal: silently re-roling would change who appears to speak, and
          // silently dropping is the 7.19.1 lie this feature was built to end.
          throw new Error(
            messagesRoleRefusal({
              site: `Agent injection '${inj.id}'`,
              role: msg.role,
              providerName: deps.provider.name,
              carries,
            }),
          );
        }

        const refusal = refusalForPlacement(history, role);
        if (refusal !== undefined) {
          deferred.push({
            injectionId: inj.id,
            flavor: inj.flavor,
            role,
            reason: refusal,
            note: messagesDeferralNote({
              injectionId: inj.id,
              role,
              reason: refusal,
              ...(tailWireRole(history) !== undefined && { tailRole: tailWireRole(history)! }),
            }),
          });
          // This injection's remaining messages wait too: delivering message 2
          // without message 1 would reorder the declaration.
          break;
        }

        const wireIndex = history.length;
        history.push({
          role,
          content: msg.content,
          injectedBy: {
            injectionId: inj.id,
            flavor: inj.flavor,
            ...(inj.description !== undefined && { reason: inj.description }),
            iteration,
          },
        });
        ledger.add(key);
        delivered.push({
          injectionId: inj.id,
          flavor: inj.flavor,
          role,
          wireIndex,
          // The messages slot and the window stage both name a piece of
          // context by `${role}:${index}:${content}`. Using the same formula
          // here means injected, delivered and evicted all say one name.
          contentHash: fnv1a(`${role}:${wireIndex}:${msg.content}`),
          key,
        });
      }
    }

    // Record every iteration, including the empty one: "the stage looked and
    // there was nothing to do" and "the stage never ran" are different facts
    // about a run, and only one of them is visible in the chart.
    scope.messagesDelivery = { iteration, delivered, deferred };
    if (delivered.length > 0) scope.history = history;
    // Persist the ledger whenever it GREW, not only when this iteration
    // delivered. It also grows by recovery — reading markers out of a window
    // that a replay restored into a fresh scope — and those keys are the whole
    // replay-safety argument. Dropping them because nothing happened to be
    // delivered this pass would make "is this already in?" depend on whether an
    // unrelated injection landed at the same moment, and would let a window
    // strategy's later eviction resurrect a message the run had already sent.
    // The ledger is a superset of what came in, so a size change is exact.
    if (ledger.size !== incoming.length) scope.deliveredMessageKeys = [...ledger];
  };
}
