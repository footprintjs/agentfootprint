import { copyJson, ownData, readOwnList } from '../../../lib/boundedJson.js';
import {
  FINDINGS_DATA_FRAME_PREFIX,
  LIBRARY_NOTE_OPENING,
  NATIVE_RECOVERY_FRAME_PREFIX,
  STAGED_DATA_FRAME_PREFIX,
} from '../../../lib/saidByPerson.js';
import { sha256Hex } from '../../../lib/sha256.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { MAX_ENTERED_TOOL_CALLS } from '../honesty/enteredToolCalls.js';
import type { ReplayPrefixFrame } from './replayPrefix.js';
import { openReplayProjection, type RequestReplayValue } from './state.js';

const MAX_BYTES = 8 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const OPENINGS = {
  'staged-refs-nudge': STAGED_DATA_FRAME_PREFIX,
  'time-window-line': LIBRARY_NOTE_OPENING,
  'evidence-conclusion': LIBRARY_NOTE_OPENING,
  'findings-data': FINDINGS_DATA_FRAME_PREFIX,
  'native-turn-recovery': NATIVE_RECOVERY_FRAME_PREFIX,
} as const;

function invalid(): never {
  throw new TypeError('[resumeOnError] checkpoint requestReplay is malformed.');
}

function dataField(object: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(object, key);
  if (field === undefined) return key in object ? invalid() : undefined;
  return field.enumerable && 'value' in field ? field.value : invalid();
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value);
}

function readFrame(value: unknown): ReplayPrefixFrame {
  const frame = ownData(value, ['id', 'contentDigest', 'libraryMessages', 'toolProjections']);
  if (
    !identifier(frame.id) ||
    !digest(frame.contentDigest) ||
    !Array.isArray(frame.libraryMessages) ||
    !Array.isArray(frame.toolProjections)
  )
    return invalid();

  const libraryMessages = frame.libraryMessages.map<ReplayPrefixFrame['libraryMessages'][number]>(
    (item) => {
      const { reason, message } = ownData(item, ['reason', 'message']);
      const { role, content } = ownData(message, ['role', 'content']);
      if (
        typeof reason !== 'string' ||
        !Object.hasOwn(OPENINGS, reason) ||
        role !== 'user' ||
        typeof content !== 'string' ||
        !content.startsWith(OPENINGS[reason as keyof typeof OPENINGS])
      )
        return invalid();
      return { reason, message: { role, content } };
    },
  );
  const distances = new Set<number>();
  const toolProjections = frame.toolProjections.map((item) => {
    const patch = ownData(item, ['distance', 'toolCallId', 'original', 'content']);
    const { distance, toolCallId, original, content } = patch;
    if (
      typeof distance !== 'number' ||
      !Number.isSafeInteger(distance) ||
      distance < 1 ||
      distances.has(distance) ||
      !identifier(toolCallId) ||
      !digest(original) ||
      typeof content !== 'string'
    )
      return invalid();
    distances.add(distance);
    return { distance, toolCallId, original, content };
  });
  return { id: frame.id, contentDigest: frame.contentDigest, libraryMessages, toolProjections };
}

function readFrames(value: unknown): readonly ReplayPrefixFrame[] {
  const detached = copyJson(value, MAX_BYTES, false, 6);
  if (!Array.isArray(detached) || detached.length === 0 || detached.length > MAX_ENTERED_TOOL_CALLS)
    return invalid();
  return detached.map(readFrame);
}

/** The verifier only needs the committed text and native turn identities. */
function readHistory(history: readonly LLMMessage[]): readonly LLMMessage[] {
  const list = readOwnList(history, Number.MAX_SAFE_INTEGER);
  if (list === undefined) return invalid();
  return list.entries.map((entry) => {
    if (entry === null || typeof entry !== 'object') return invalid();
    const role = dataField(entry, 'role');
    const content = dataField(entry, 'content');
    const toolCallId = dataField(entry, 'toolCallId');
    const rawCalls = dataField(entry, 'toolCalls');
    const rawReplay = dataField(entry, 'replay');
    if (
      (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') ||
      typeof content !== 'string' ||
      (toolCallId !== undefined && typeof toolCallId !== 'string')
    )
      return invalid();
    const calls =
      rawCalls === undefined ? undefined : readOwnList(rawCalls, MAX_ENTERED_TOOL_CALLS);
    if (rawCalls !== undefined && (calls === undefined || calls.unread > 0)) return invalid();
    return {
      role,
      content,
      ...(toolCallId !== undefined && { toolCallId }),
      ...(calls !== undefined && {
        toolCalls: calls.entries.map((call) => {
          if (call === null || typeof call !== 'object') return invalid();
          const id = dataField(call, 'id');
          if (typeof id !== 'string') return invalid();
          return { id, name: '', args: {} };
        }),
      }),
      ...(rawReplay !== undefined && {
        replay: copyJson(rawReplay, MAX_BYTES, false, 6) as LLMMessage['replay'],
      }),
    };
  });
}

function verified(frames: readonly ReplayPrefixFrame[], history: readonly LLMMessage[]): boolean {
  const expected = new Map(frames.map((frame) => [frame.id, frame]));
  const anchors = history.flatMap(({ role, replay }, index) =>
    role === 'assistant' && replay !== undefined && expected.has(replay.id)
      ? [{ replay, index }]
      : [],
  );
  return (
    anchors.length === frames.length &&
    anchors.every(
      ({ replay, index }) =>
        replay.version === 1 &&
        replay.protocol === 'anthropic-messages' &&
        replay.stopReason === 'tool_use' &&
        replay.lossy !== true &&
        replay.thinkingRetired !== true &&
        expected.get(replay.id)?.toolProjections.every(({ distance, toolCallId, original }) => {
          const source = history[index - distance];
          return (
            source?.role === 'tool' &&
            source.toolCallId === toolCallId &&
            sha256Hex(source.content) === original
          );
        }),
    ) &&
    anchors[0]?.replay?.binding !== undefined &&
    anchors[0].replay.layout.some((part) => part.type === 'thinking') &&
    openReplayProjection({ frames }, history, history) !== undefined
  );
}

/** Recover only the prefix that belongs to the last committed iteration bracket. */
export function captureRequestReplayCheckpoint(
  state: unknown,
  history: readonly LLMMessage[],
): RequestReplayValue | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  try {
    const list = readOwnList(dataField(state, 'requestReplay'), MAX_ENTERED_TOOL_CALLS + 1);
    if (list === undefined || list.unread > 0 || list.entries.length === 0) return undefined;
    const last = list.entries.at(-1);
    // A terminal assistant omitted from conversation has no committed replay
    // witness at this door. Never promote it to a trusted end_turn on recovery.
    const entries =
      last !== null && typeof last === 'object' && Object.hasOwn(last, 'closing')
        ? list.entries.slice(0, -1)
        : list.entries;
    const admittedHistory = readHistory(history);
    const ids = new Set(
      admittedHistory.flatMap(({ role, replay }) =>
        role === 'assistant' && replay !== undefined ? [replay.id] : [],
      ),
    );
    const hasAnchor = (entry: unknown): boolean => {
      if (entry === null || typeof entry !== 'object') return false;
      const id = dataField(entry, 'id');
      return typeof id === 'string' && ids.has(id);
    };
    const firstUncommitted = entries.findIndex((entry) => !hasAnchor(entry));
    if (firstUncommitted === 0) return undefined;
    if (firstUncommitted > 0 && entries.slice(firstUncommitted).some(hasAnchor)) return undefined;
    const frames = readFrames(
      firstUncommitted === -1 ? entries : entries.slice(0, firstUncommitted),
    );
    return verified(frames, admittedHistory) ? frames : undefined;
  } catch {
    // An unreadable native carrier must not replace the original run failure.
    return undefined;
  }
}

/** Admit a saved same-request prefix as own data before it can shape a request. */
export function admitRequestReplayCheckpoint(
  checkpoint: unknown,
  history: readonly LLMMessage[],
): RequestReplayValue | undefined {
  if (checkpoint === null || typeof checkpoint !== 'object') return invalid();
  try {
    const field = dataField(checkpoint, 'requestReplay');
    if (field === undefined && !Object.hasOwn(checkpoint, 'requestReplay')) return undefined;
    const frames = readFrames(field);
    return verified(frames, readHistory(history)) ? frames : invalid();
  } catch {
    return invalid();
  }
}
