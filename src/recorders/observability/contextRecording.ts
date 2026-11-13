import { recordRun, type RecordRunOptions, type RunRecorder } from './recordRun.js';
import { writeContextRecording } from './contextRecording/write.js';
import { releaseCaptures } from './contextRecording/lifetime.js';
import {
  contextRefusal,
  type ContextValueRecording,
  type ContextValueWriter,
} from './contextRecording/types.js';

/** A run with opt-in source-time context capture and asynchronous value ids. */
export interface ContextRunRecorder extends Omit<RunRecorder, 'toRecording'> {
  toRecording(): Promise<ContextValueRecording>;
}

export interface RecordContextRunOptions extends RecordRunOptions {
  /**
   * Additional mounted runners whose sensitive context may be captured.
   * Declare them explicitly; recording never invokes UI translators or
   * guesses members from serialized topology. A missing frame is a refusal.
   */
  readonly members?: readonly Parameters<typeof recordRun>[0][];
}

/**
 * Record complete context once, and each logical call as a change list.
 * Start BEFORE the run. Pass a fresh foottrace value table with an identity
 * redactor: the native run has ALREADY served every value under its policy.
 * The ordinary recordRun API and all provider requests stay unchanged.
 *
 * An exact context.recorded subscription opts this instance and the explicitly
 * named members into additional sensitive context events for this recorder's
 * lifetime; ordinary wildcard sinks alone do not. Every sink sees the same
 * served event once opted in. This is not a new session-authorization boundary.
 */
export function recordContextRun(
  runner: Parameters<typeof recordRun>[0],
  values: ContextValueWriter,
  options: RecordContextRunOptions = {},
): ContextRunRecorder {
  const offs: (() => void)[] = [];
  let recorder: RunRecorder;
  try {
    for (const member of new Set([runner, ...(options.members ?? [])]))
      offs.push(member.on('agentfootprint.context.recorded', () => undefined));
    recorder = recordRun(runner, options);
  } catch (error) {
    releaseCaptures(offs, { error });
    throw error;
  }
  let stopped = false;
  const result = Object.create(null) as ContextRunRecorder;
  const descriptors = Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(recorder)).filter(
      ([key]) => key !== 'toRecording' && key !== 'stop',
    ),
  );
  Object.defineProperties(result, descriptors);
  Object.defineProperties(result, {
    toRecording: {
      value: async () => {
        try {
          return await writeContextRecording(
            recorder.toRecording(),
            values,
            recorder.droppedEvents,
            recorder.firstRetainedEventIndex,
          );
        } catch (error) {
          throw contextRefusal(error);
        }
      },
    },
    stop: {
      value: () => {
        if (stopped) return;
        stopped = true;
        let failure: { readonly error: unknown } | undefined;
        try {
          recorder.stop();
        } catch (error) {
          failure = { error };
        }
        releaseCaptures(offs, failure);
      },
    },
  });
  return result;
}

export { readContextRecording } from './contextRecording/read.js';
export { applyContextChange } from './contextRecording/changes.js';
export { contextCallCommentary } from './contextRecording/commentary.js';
export {
  ContextRecordingError,
  type ContextCallChange,
  type ContextValueWriter,
  type ContextValueReader,
  type ContextValueRecording,
  type OpenContextValues,
  type ReadContextRecording,
} from './contextRecording/types.js';
