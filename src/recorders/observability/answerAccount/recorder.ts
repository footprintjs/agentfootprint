import type { AgentfootprintEvent } from '../../../events/registry.js';
import { jsonBytes } from '../../../lib/boundedJson.js';
import { servedUnderPolicy } from '../../../redaction/marker.js';
import {
  recordRunWhere,
  type RecordableRunner,
  type RecordRunOptions,
  type RecordingObservation,
  type RunRecorder,
} from '../recordRun.js';
import type {
  AccountEvidenceGap,
  AccountEventEvidence,
  AnswerAccountEvidence,
} from './evidence.js';
import {
  containsToolHistory,
  ownValue,
  projectEvent,
  projectState,
  requiresMoreEvidence,
} from './project.js';

const WRAPPER_BYTES = 512;
/** Testable limit for the internal collector, separate from production filing and response budgets. */
const MAX_RAW_BYTES = 16 * 1024 * 1024;

export interface AnswerAccountRecorder {
  readonly recording: RunRecorder;
  /** Only a sealed result is handed out. No copy is installed on the normal recording. */
  toSnapshot(): AnswerAccountEvidence | undefined;
  /** Serialized footprint of admitted event projections at their high-water mark. */
  readonly peakRetainedEventBytes: number;
}

/** Internal opt-in. The native hook is deliberately not a snapshot-producing attachment. */
export function recordAnswerAccount(
  runner: RecordableRunner,
  maxBytes: number,
  options: Omit<RecordRunOptions, 'trustBoundaries'> = {},
  keep: (event: AgentfootprintEvent) => boolean = () => true,
): AnswerAccountRecorder {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= WRAPPER_BYTES || maxBytes > MAX_RAW_BYTES)
    throw new RangeError('Invalid in-memory explanation budget.');

  const events = new Map<number, { event: AccountEventEvidence['event']; bytes: number }>();
  const gaps = new Set<AccountEvidenceGap>();
  let firstRetainedIndex = 0;
  let bytes = WRAPPER_BYTES;
  let peakRetainedEventBytes = 0;
  let started = false;
  let committed = false;
  let finished = false;
  let hasTerminalAnswer = false;
  let evidence: AnswerAccountEvidence | undefined;

  const discard = () => {
    events.clear();
    bytes = WRAPPER_BYTES;
  };

  const finish: RecordingObservation['seal'] = (snapshot, first, recordingIndex) => {
    if (!started) gaps.add('no-start');
    if (!finished || !committed || !hasTerminalAnswer || snapshot === undefined)
      gaps.add('no-terminal-commit');
    if (first > 0) gaps.add('retained-events-dropped');
    if (servedUnderPolicy(snapshot)) {
      discard();
      peakRetainedEventBytes = 0;
      evidence = Object.freeze({
        version: 1,
        gaps: Object.freeze(['redaction'] as const),
        firstRetainedIndex: 0,
        events: Object.freeze([]),
      });
      return;
    }
    if (ownValue(ownValue(snapshot, 'initialState'), 'history') !== undefined)
      gaps.add('resumed-state');
    if (containsToolHistory(snapshot)) gaps.add('tool-results');
    let state: AnswerAccountEvidence['state'];
    if (gaps.size === 0) {
      try {
        state = projectState(snapshot, maxBytes - bytes);
      } catch {
        gaps.add('budget');
      }
    }
    if (gaps.has('no-start') || gaps.has('multiple-runs')) discard();
    evidence = Object.freeze({
      version: 1,
      gaps: Object.freeze([...gaps].sort()),
      firstRetainedIndex: first,
      events: Object.freeze(
        [...events].flatMap(([ordinal, row]) => {
          const index = recordingIndex(ordinal);
          return index === undefined ? [] : [Object.freeze({ index, event: row.event })];
        }),
      ),
      ...(state === undefined ? {} : { state }),
    });
    discard();
  };

  const observation: RecordingObservation = {
    native: {
      id: 'agentfootprint:answer-account-observation',
      delivery: 'inline',
      onRunStart() {
        if (started) {
          gaps.add('multiple-runs');
          discard();
        }
        started = true;
      },
      onCommit() {
        committed = true;
      },
      onRunEnd() {
        finished = true;
      },
    },
    accepted(event, ordinal, first) {
      if (first !== firstRetainedIndex) {
        firstRetainedIndex = first;
        for (const [key, row] of events) {
          if (key >= first) break;
          events.delete(key);
          bytes -= row.bytes;
        }
      }
      if (event.type === 'agentfootprint.agent.turn_end') hasTerminalAnswer = true;
      if (gaps.has('budget') || gaps.has('multiple-runs')) return;
      if (
        event.type === 'agentfootprint.stream.tool_start' ||
        event.type === 'agentfootprint.stream.tool_end'
      )
        gaps.add('tool-results');
      if (event.type === 'agentfootprint.pause.resume') gaps.add('resumed-state');
      else if (requiresMoreEvidence(event.type)) gaps.add('unsupported-evidence');

      try {
        const projected = projectEvent(event, maxBytes - bytes);
        const rowBytes = 1 + jsonBytes({ index: ordinal, event: projected });
        if (bytes + rowBytes > maxBytes) throw new RangeError('Explanation event budget reached.');
        events.set(ordinal, { event: projected, bytes: rowBytes });
        bytes += rowBytes;
        peakRetainedEventBytes = Math.max(peakRetainedEventBytes, bytes - WRAPPER_BYTES);
      } catch {
        gaps.add('budget');
        discard();
      }
    },
    seal: finish,
  };
  const recording = recordRunWhere(runner, keep, options, undefined, undefined, observation);
  return {
    recording,
    toSnapshot: () => evidence,
    get peakRetainedEventBytes() {
      return evidence === undefined ? 0 : peakRetainedEventBytes;
    },
  };
}
