/**
 * The check one request receives on a model that binds its reasoning to the
 * context it was written under — and the baselines signed responses leave.
 *
 * THE RULE. The request is compared with the request the NEWEST signed
 * reasoning on its wire was written under — that response's own baseline,
 * found by its replay id. Three questions decide what follows, each asked of
 * the provider the call goes to (never a blend with providers it may fail
 * over to, whose own adapters check the calls they serve):
 *
 *   - Is THIS model `bound`, `unknown` or `unbound`? Unbound: not asked at all.
 *   - Did a bound model of the same family write that reasoning
 *     (`replay.binding.model`, the same test the adapter's guard makes)? A
 *     block an unbound model wrote carries nothing to check; a block another
 *     family wrote meets the API's model check, which drops it, never refuses.
 *     Either way there is nothing here to compare: no row.
 *   - Is that reasoning in an unfinished tool turn?
 *
 * A bound model, its own family's block, an unfinished tool turn and any
 * difference: refused by name (`ContextChangedError`) before the request is
 * sent — the API would refuse it anyway. Any other difference is recorded and
 * the request is sent: a finished turn (the adapter retires that reasoning
 * and reports it), the wrap-up leaving the signed turn out, or a model whose
 * binding is `unknown` (an id the adapter cannot place may serve an older
 * model, and such a run works today). Signed reasoning whose response this
 * run did not record (a continued or restored conversation) is recorded
 * `unchecked`, once for that response.
 */
import type { ContextChange, ContextChangeCheck } from '../../../events/payloads/contextChange.js';
import type { LLMMessage, LLMResponse } from '../../../provider-contract/types.js';
import { completedAnthropicThrough } from '../../../thinking/anthropicTurn.js';
import type { ThinkingBinding } from '../../../provider-contract/thinkingBinding.js';
import { ContextChangedError } from '../../../thinking/contextChange.js';
import { contextChanges } from './compare.js';
import {
  baselineOf,
  messageEntries,
  pieceEntries,
  systemTextHash,
  toolEntries,
  type ContextBaseline,
  type RequestContext,
} from './composition.js';

/** The most changes one check names; the rest are counted. */
export const MAX_CONTEXT_CHANGES = 16;

/** Signed responses whose baselines one run keeps; the oldest goes first. */
export const MAX_BASELINES = 16;

/** The run's baselines, one per signed response, keyed by its replay id. */
export interface ContextBaselineHolder {
  bases?: Map<string, ContextBaseline>;
  /** The newest response that left a baseline. */
  latest?: string;
  /** Responses already reported `unchecked`, so a row says it once. */
  unchecked?: Set<string>;
}

export interface ContextCheckOutcome {
  /** The record for `llm_start`; absent when nothing changed. */
  readonly note?: ContextChangeCheck;
  /** Present when the request must not be sent. */
  readonly refusal?: ContextChangedError;
}

/** Signed reasoning a provider will check: a signature, or a replay layout that kept thinking. */
export function holdsSignedThinking(message: LLMMessage): boolean {
  if (message.role !== 'assistant') return false;
  if (message.thinkingBlocks?.some((b) => typeof b.signature === 'string' && b.signature !== ''))
    return true;
  const replay = message.replay;
  return (
    replay?.version === 1 &&
    replay.thinkingRetired !== true &&
    Array.isArray(replay.layout) &&
    replay.layout.some((part) => part.type === 'thinking')
  );
}

function newestSigned(messages: readonly LLMMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (holdsSignedThinking(messages[i])) return i;
  return -1;
}

/** The binding the check runs under: never `unbound` (the caller does not ask then). */
export type CheckedBinding = ThinkingBinding & { readonly binding: 'bound' | 'unknown' };

function note(
  changes: readonly ContextChange[],
  refused: boolean,
  binding: CheckedBinding,
): ContextChangeCheck {
  const kept = changes.slice(0, MAX_CONTEXT_CHANGES);
  return {
    check: 'compared',
    refused,
    binding: binding.binding,
    by: binding.by,
    ...(binding.appStatement === 'failed' && { appStatement: 'failed' as const }),
    changes: kept,
    ...(changes.length > kept.length && { omittedChanges: changes.length - kept.length }),
  };
}

function compare(base: ContextBaseline, request: RequestContext): ContextChange[] {
  return contextChanges(base, {
    systemText: systemTextHash(request.systemText),
    system: pieceEntries(request.systemPieces),
    tools: toolEntries(request.tools, request.parties),
    messages: messageEntries(request.wire.slice(0, base.messages.length)),
  });
}

/** The question a check asks: this call's target, and how the provider reads another model id. */
export interface CheckTarget {
  readonly provider: string;
  readonly model: string;
  readonly binding: CheckedBinding;
  /** The provider's answer for the model that wrote a block (`replay.binding.model`). */
  readonly bindingOf: (model: string) => ThinkingBinding;
}

/** Did a bound model of the target's family write this block? Else nothing here is checked. */
function checkedByTarget(writer: string | undefined, target: CheckTarget): boolean {
  if (writer === undefined) return false;
  const wrote = target.bindingOf(writer);
  if (wrote.binding === 'unbound') return false;
  return wrote.family !== undefined && target.binding.family !== undefined
    ? wrote.family === target.binding.family
    : writer === target.model;
}

function keep<T>(set: Set<T>, value: T): void {
  set.add(value);
  if (set.size > MAX_BASELINES) set.delete(set.values().next().value as T);
}

export function checkContextBinding(
  holder: ContextBaselineHolder,
  request: RequestContext & CheckTarget,
): ContextCheckOutcome {
  const bases = holder.bases;
  const at = newestSigned(request.wire);
  if (at === -1) {
    // The wire carries no signed reasoning, so nothing can be refused. If the
    // newest signed response is on the wire, its reasoning was retired and
    // nothing is bound any more. If it is not, the signed turn was left out of
    // the request (the wrap-up does this): an edit, recorded.
    const latest = holder.latest === undefined ? undefined : bases?.get(holder.latest);
    if (
      latest === undefined ||
      !checkedByTarget(latest.writer, request) ||
      request.wire.some((m) => m.replay?.id === latest.replayId)
    )
      return {};
    const changes: ContextChange[] = [
      ...compare(latest, request),
      { slot: 'messages', change: 'removed', position: latest.messages.length, role: 'assistant' },
    ];
    return { note: note(changes, false, request.binding) };
  }
  const message = request.wire[at];
  if (!checkedByTarget(message.replay?.binding?.model, request)) return {};
  const replayId = message.replay?.id;
  const base = replayId === undefined ? undefined : bases?.get(replayId);
  if (base === undefined) {
    // Not on this run's record. Said once per response, not on every call.
    const key = replayId ?? `position:${at}`;
    holder.unchecked ??= new Set();
    if (holder.unchecked.has(key)) return {};
    keep(holder.unchecked, key);
    return {
      note: {
        check: 'unchecked',
        refused: false,
        binding: request.binding.binding,
        by: request.binding.by,
        ...(request.binding.appStatement === 'failed' && { appStatement: 'failed' as const }),
        changes: [],
      },
    };
  }
  const changes = compare(base, request);
  if (changes.length === 0) return {};
  const refused =
    request.binding.binding === 'bound' && at > completedAnthropicThrough(request.wire);
  const row = note(changes, refused, request.binding);
  return {
    note: row,
    ...(refused && {
      refusal: new ContextChangedError(
        request.provider,
        request.model,
        at,
        row.changes,
        row.omittedChanges ?? 0,
      ),
    }),
  };
}

/** After an accepted response: a signed one leaves its baseline, keyed by its replay id. */
export function rememberContextBaseline(
  holder: ContextBaselineHolder,
  request: RequestContext,
  response: LLMResponse,
): void {
  const replay = response.replay;
  if (
    replay?.version !== 1 ||
    !replay.id ||
    replay.lossy === true ||
    !replay.layout.some((part) => part.type === 'thinking')
  )
    return;
  holder.bases ??= new Map();
  holder.bases.delete(replay.id);
  holder.bases.set(replay.id, baselineOf(replay.id, replay.binding?.model, request));
  const oldest = holder.bases.keys().next();
  if (holder.bases.size > MAX_BASELINES && oldest.done !== true) holder.bases.delete(oldest.value);
  holder.latest = replay.id;
}
