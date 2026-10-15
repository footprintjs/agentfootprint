/** Pure message matching for durable omissions; no second conversation store. */
import type { LLMMessage } from '../provider-contract/types.js';
import type { ReplayPreparation } from './replay.js';
import { canonicalJson } from '../lib/canonicalJson.js';
import { sha256Hex } from '../lib/sha256.js';

/** Only an approved thinking edit, never a replacement conversation or tool result. */
export interface ReplayRetirement {
  readonly replayId?: string;
  readonly messageFingerprint: string;
  readonly thinkingBlocks: LLMMessage['thinkingBlocks'];
  readonly replay?: LLMMessage['replay'];
}

/** Narrow a transport report before a checkpoint owner retains it. */
export function replayRetirements(preparation: ReplayPreparation): readonly ReplayRetirement[] {
  const seen = new Set<number>();
  return preparation.omissions.flatMap((omission) => {
    if (seen.has(omission.messageIndex)) return [];
    seen.add(omission.messageIndex);
    const replacement = preparation.request.messages[omission.messageIndex];
    if (replacement === undefined)
      throw new Error('Replay omission has no matching prepared message.');
    return [
      {
        ...(omission.replayId !== undefined && { replayId: omission.replayId }),
        messageFingerprint: omission.messageFingerprint,
        thinkingBlocks: replacement.thinkingBlocks,
        ...(replacement.replay !== undefined && { replay: replacement.replay }),
      },
    ];
  });
}

/** A local matching key, not a signature validator or public authentication. */
export function replayMessageFingerprint(message: LLMMessage): string {
  return sha256Hex(
    canonicalJson({
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls,
      thinkingBlocks: message.thinkingBlocks,
    }),
  );
}

/** Apply only reported thinking omissions, retaining all host-owned metadata. */
export function retireReplayHistory(
  history: readonly LLMMessage[],
  preparation: ReplayPreparation,
): readonly LLMMessage[] {
  return applyReplayRetirements(history, replayRetirements(preparation));
}

/** One identity rule for live history, retries and both checkpoint doors. */
export function applyReplayRetirements(
  history: readonly LLMMessage[],
  retirements: readonly ReplayRetirement[],
): readonly LLMMessage[] {
  if (retirements.length === 0) return history;
  let changed = false;
  const next = history.map((message) => {
    const omission = retirements.find((item) =>
      item.replayId !== undefined
        ? message.replay?.id === item.replayId
        : !message.replay?.id && replayMessageFingerprint(message) === item.messageFingerprint,
    );
    if (omission === undefined || !message.thinkingBlocks?.length) return message;
    changed = true;
    return {
      ...message,
      thinkingBlocks: omission.thinkingBlocks,
      ...(omission.replay !== undefined && { replay: omission.replay }),
    };
  });
  return changed ? next : history;
}
