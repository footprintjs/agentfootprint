/**
 * The check one request receives on a model that binds its reasoning to the
 * context it was written under — and the baseline a signed response leaves.
 *
 * THE RULE. The request is compared with the request the NEWEST signed
 * reasoning in its history was written under. On a `bound` model, if that
 * reasoning belongs to an unfinished tool turn and anything differs, the
 * request is refused by name (`ContextChangedError`) before it is sent: the
 * API would refuse it anyway. On a model whose binding is `unknown` (an id the
 * adapter cannot place, which may serve an older model whose thinking is not
 * bound) the same difference is recorded and the request is sent: refusing it
 * would turn a run that works today into one that fails.
 * Any other difference is recorded, not refused — a finished turn's reasoning
 * may be retired, which the adapter already does and reports. A history whose
 * baseline is not on this run's record (a continued or restored conversation)
 * is recorded `unchecked`.
 *
 * Nothing is computed for a run whose history holds no signed reasoning, and
 * the caller asks only on a bound model, so every other run is untouched.
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

/** The run's one baseline: the request behind the newest signed response. */
export interface ContextBaselineHolder {
  current?: ContextBaseline;
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

function capped(
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

export function checkContextBinding(
  holder: ContextBaselineHolder,
  request: RequestContext & {
    readonly provider: string;
    readonly model: string;
    readonly binding: CheckedBinding;
  },
): ContextCheckOutcome {
  const base = holder.current;
  const at = newestSigned(request.wire);
  if (at === -1) {
    // The wire carries no signed reasoning, so nothing can be refused. If the
    // response behind this run's baseline is on the wire, its reasoning was
    // retired and nothing is bound any more. If it is not, the signed turn was
    // left out of the request (the wrap-up does this): an edit, recorded.
    if (base === undefined || request.wire.some((m) => m.replay?.id === base.replayId)) return {};
    const changes: ContextChange[] = [
      ...compare(base, request),
      { slot: 'messages', change: 'removed', position: base.messages.length, role: 'assistant' },
    ];
    return { note: capped(changes, false, request.binding) };
  }
  const replayId = request.wire[at].replay?.id;
  if (base === undefined || replayId === undefined || replayId !== base.replayId)
    return {
      note: {
        check: 'unchecked',
        refused: false,
        binding: request.binding.binding,
        by: request.binding.by,
        changes: [],
      },
    };
  const changes = compare(base, request);
  if (changes.length === 0) return {};
  const refused =
    request.binding.binding === 'bound' && at > completedAnthropicThrough(request.wire);
  const note = capped(changes, refused, request.binding);
  return {
    note,
    ...(refused && {
      refusal: new ContextChangedError(
        request.provider,
        request.model,
        at,
        note.changes,
        note.omittedChanges ?? 0,
      ),
    }),
  };
}

/** After an accepted response: a signed one becomes the run's baseline. */
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
  holder.current = baselineOf(replay.id, request);
}
