import type { LLMMessage, LLMResponse } from '../../../provider-contract/types.js';
import { matchesPreparedData } from '../../../lib/matchesPreparedData.js';
import type { ThinkingBlock } from '../../../thinking/types.js';
import { completedAnthropicThrough } from '../../../thinking/anthropicTurn.js';
import {
  restoreReplayPrefix,
  type ReplayPrefixFrame,
  type RequestOnlyMessage,
} from './replayPrefix.js';

interface RequestReplayState {
  readonly frames: readonly ReplayPrefixFrame[];
  /** Captured at acceptance, before any output checker can rewrite the draft. */
  readonly closing?: LLMMessage;
}

/** A flat list so native delta recording can append a newly accepted response. */
export type RequestReplayValue =
  | readonly ReplayPrefixFrame[]
  | readonly [...ReplayPrefixFrame[], { readonly closing: LLMMessage }];

export function readRequestReplay(value: RequestReplayValue): RequestReplayState {
  const last = value.at(-1);
  return last !== undefined && 'closing' in last
    ? { frames: value.slice(0, -1) as readonly ReplayPrefixFrame[], closing: last.closing }
    : { frames: value as readonly ReplayPrefixFrame[] };
}

/** A witnessed end releases the earlier prefix for new presentation. */
export function openReplayProjection(
  state: RequestReplayState | undefined,
  history: readonly LLMMessage[],
  rendered: readonly LLMMessage[],
) {
  if (state === undefined) return undefined;
  const projection = restoreReplayPrefix(history, rendered, state.frames);
  return projection !== undefined &&
    completedAnthropicThrough(history) < projection.frozenBefore - 1
    ? projection
    : undefined;
}

/** Only identical ordered values may seed a later replay. A transport's
 * approved retirement may alter thinking metadata without changing the text. */
export function sameReplayProjection(
  expected: readonly LLMMessage[],
  actual: readonly LLMMessage[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((message, index) => {
      const sent = actual[index];
      if (matchesPreparedData(message, sent)) return true;
      if (sent?.replay?.thinkingRetired !== true || sent.replay.id !== message.replay?.id)
        return false;
      return matchesPreparedData(withoutThinking(message), withoutThinking(sent));
    })
  );
}

function withoutThinking({ replay, thinkingBlocks, ...message }: LLMMessage) {
  void replay;
  void thinkingBlocks;
  return message;
}

/** Keep library contributions only after an actual accepted native response. */
export function afterReplayResponse(
  response: LLMResponse,
  frames: readonly ReplayPrefixFrame[],
  capture: (replay: NonNullable<LLMResponse['replay']>) => ReplayPrefixFrame,
  mayNeedClosure: boolean,
): RequestReplayValue | undefined {
  const replay = response.replay;
  const retained = frames.length > 0 ? frames : undefined;
  if (
    replay?.version !== 1 ||
    replay.protocol !== 'anthropic-messages' ||
    !replay.id ||
    replay.lossy
  )
    return retained;
  if (
    mayNeedClosure &&
    replay.stopReason === 'end_turn' &&
    response.toolCalls.length === 0 &&
    !replay.layout.some((part) => part.type === 'tool') &&
    frames.length > 0
  ) {
    return [...frames, { closing: { role: 'assistant', content: response.content, replay } }];
  }
  const signed =
    replay.binding !== undefined && replay.layout.some((part) => part.type === 'thinking');
  if (replay.stopReason !== 'tool_use' || (!signed && frames.length === 0)) return retained;
  return [...frames, capture(replay)];
}

/** Recover with a genuine terminal response. The draft is still absent from public history. */
export function privateTurnEnd(
  history: readonly LLMMessage[],
  closing: LLMMessage | undefined,
  thinkingBlocks: readonly ThinkingBlock[],
): RequestOnlyMessage | undefined {
  if (closing === undefined || history.some((message) => message.replay?.id === closing.replay?.id))
    return undefined;
  const message: LLMMessage = { ...closing, ...(thinkingBlocks.length > 0 && { thinkingBlocks }) };
  return completedAnthropicThrough([...history, message]) === history.length
    ? { message, reason: 'native-turn-end' }
    : undefined;
}
