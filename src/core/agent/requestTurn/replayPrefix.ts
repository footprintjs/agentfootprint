import { sha256Hex } from '../../../lib/sha256.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import type { MessageReplay } from '../../../thinking/replay.js';
import type { CacheMarker } from '../../../cache/types.js';

export interface RequestOnlyMessage {
  readonly message: LLMMessage;
  readonly reason: string;
}

interface ToolProjection {
  readonly distance: number;
  readonly toolCallId: string;
  readonly original: string;
  readonly content: string;
}

/** A response anchors only the library's additions and substitutions, never a copy of history. */
export interface ReplayPrefixFrame {
  readonly id: string;
  readonly contentDigest: string;
  readonly libraryMessages: readonly RequestOnlyMessage[];
  readonly toolProjections: readonly ToolProjection[];
}

/** Capture the newly served span. Earlier bytes already have an owner in an earlier frame. */
export function captureReplayPrefix(
  response: MessageReplay,
  history: readonly LLMMessage[],
  rendered: readonly LLMMessage[],
  libraryMessages: readonly RequestOnlyMessage[],
  from: number,
): ReplayPrefixFrame {
  const toolProjections: ToolProjection[] = [];
  for (let index = from; index < history.length; index++) {
    const source = history[index];
    const result = rendered[index];
    if (
      source.role === 'tool' &&
      source.toolCallId !== undefined &&
      source.content !== result.content
    ) {
      toolProjections.push({
        distance: history.length - index,
        toolCallId: source.toolCallId,
        original: sha256Hex(source.content),
        content: result.content,
      });
    }
  }
  return {
    id: response.id,
    contentDigest: response.contentDigest,
    libraryMessages,
    toolProjections,
  };
}

export interface ReplayPrefixProjection {
  /** The history projection still has one entry per committed message. */
  readonly history: readonly LLMMessage[];
  /** Current wire order, with previously served additions before their original responses. */
  readonly wire: readonly LLMMessage[];
  /** Proven history position of each wire entry. Request-only additions have no position. */
  readonly historyPositions: readonly (number | undefined)[];
  readonly additions: readonly (RequestOnlyMessage & { readonly wireIndex: number })[];
  /** Only messages after this boundary may receive a fresh projection. */
  readonly frozenBefore: number;
}

/** Reapply library-owned deltas only. Caller edits and missing witnesses stay visible to the adapter. */
export function restoreReplayPrefix(
  history: readonly LLMMessage[],
  rendered: readonly LLMMessage[],
  frames: readonly ReplayPrefixFrame[],
): ReplayPrefixProjection | undefined {
  if (frames.length === 0) return undefined;
  const positions = new Map<string, number>();
  for (const [index, entry] of history.entries()) {
    if (entry.role !== 'assistant' || entry.replay === undefined) continue;
    const id = entry.replay.id;
    positions.set(id, positions.has(id) ? -1 : index);
  }
  const byPosition = new Map<number, ReplayPrefixFrame>();
  const replacements = new Map<number, ToolProjection>();
  let previous = -1;
  for (const frame of frames) {
    const index = positions.get(frame.id);
    if (
      index === undefined ||
      index <= previous ||
      history[index].replay?.contentDigest !== frame.contentDigest
    )
      return undefined;
    byPosition.set(index, frame);
    for (const item of frame.toolProjections) {
      const position = index - item.distance;
      if (position <= previous || position >= index) return undefined;
      replacements.set(position, item);
    }
    previous = index;
  }

  const restored: LLMMessage[] = [];
  const wire: LLMMessage[] = [];
  const historyPositions: (number | undefined)[] = [];
  const additions: ReplayPrefixProjection['additions'][number][] = [];
  for (const [index, original] of history.entries()) {
    for (const line of byPosition.get(index)?.libraryMessages ?? []) {
      additions.push({ ...line, wireIndex: wire.length });
      wire.push(line.message);
      historyPositions.push(undefined);
    }
    const patch = replacements.get(index);
    const message = index < previous ? original : rendered[index];
    const projection =
      patch !== undefined &&
      message.toolCallId === patch.toolCallId &&
      sha256Hex(message.content) === patch.original
        ? { ...message, content: patch.content }
        : message;
    restored.push(projection);
    wire.push(projection);
    historyPositions.push(index);
  }
  return { history: restored, wire, historyPositions, additions, frozenBefore: previous + 1 };
}

/** Breakpoints are offered in history coordinates, but providers take wire positions. */
export function replayCacheMarkers(
  markers: readonly CacheMarker[],
  projection: ReplayPrefixProjection | undefined,
): readonly CacheMarker[] {
  if (projection === undefined || projection.additions.length === 0) return markers;
  const wireAt = new Map<number, number>();
  for (const [wire, history] of projection.historyPositions.entries()) {
    if (history !== undefined) wireAt.set(history, wire);
  }
  return markers.map((marker) => {
    if (marker.field !== 'messages') return marker;
    const boundaryIndex = wireAt.get(marker.boundaryIndex);
    return boundaryIndex === undefined ? marker : { ...marker, boundaryIndex };
  });
}
