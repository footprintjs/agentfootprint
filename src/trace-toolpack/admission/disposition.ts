import { pathSegments } from 'foottrace/paths';
import {
  readRecordedResultDecision,
  readResultDispositionMark,
} from '../../core/agent/recordedCalls/resultDispositions.js';
import { readOwnList } from '../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../lib/callOccurrence.js';
import { isPlaceholder } from '../../redaction/marker.js';
import { readNotDispatched } from '../../semantics/toolRan.js';
import type { TraceToolpackArtifacts } from '../types.js';

const unreadable = Symbol('unreadable trace evidence');
const maxEntries = 131_072;
const resultEvents = new Set<unknown>([
  'agentfootprint.stream.tool_end',
  'agentfootprint.tools.absent',
  'agentfootprint.tools.coverage_declared',
  'agentfootprint.tools.semantics_declared',
]);
const evidenceKeys = ['middlewareDecisions', 'history', 'settledToolCalls'] as const;

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(record: object, key: string): unknown {
  const slot = Object.getOwnPropertyDescriptor(record, key);
  if (slot === undefined) return undefined;
  return 'value' in slot ? slot.value : unreadable;
}

function address(row: object): string | undefined {
  const key = readCallOccurrenceKey(row);
  if (typeof key === 'string') return `key:${key}`;
  if (key === null) return undefined;
  const id = field(row, 'toolCallId');
  const name = field(row, 'toolName');
  return typeof id === 'string' && typeof name === 'string' && id.length + name.length <= 4096
    ? `legacy:${JSON.stringify([id, name])}`
    : undefined;
}

function didNotDispatch(row: object): boolean {
  if (field(row, 'entered') === false || field(row, 'notExecuted') === true) return true;
  const marker = field(row, 'notDispatched');
  if (!isObject(marker)) return false;
  const paused = field(marker, 'pausedCall');
  if (!isObject(paused)) return false;
  return (
    readNotDispatched({
      pausedCall: { toolCallId: field(paused, 'toolCallId'), toolName: field(paused, 'toolName') },
    }) === 'settled'
  );
}

/** Absence of a changed decision is usable only after reading the bounded
 * record evidence, including older commits. A window can remove the message
 * that carried the mark while either the decision or old value remains. */
export function requiresTraceAdmission(artifacts: TraceToolpackArtifacts): boolean {
  const committedResults = new Set<string>();
  const unchangedResults = new Set<string>();
  const observedResults = new Set<string>();
  let committedDecisionLedger = false;
  let observedUnkeyedResult = false;
  let remaining = maxEntries;
  const scan = (value: unknown, affected: (row: unknown) => boolean): boolean => {
    const list = readOwnList(value, remaining);
    if (list === undefined || list.unread > 0) return true;
    remaining -= list.entries.length;
    return list.entries.some(affected);
  };
  const inspectDecision = (row: unknown, committed: boolean): boolean => {
    const decision = readRecordedResultDecision(row);
    if (decision === undefined) return false;
    if (decision !== 'unchanged' || !isObject(row)) return true;
    const key = address(row);
    if (key === undefined) return true;
    if (committed) unchangedResults.add(key);
    return false;
  };
  const inspectResult = (row: object, output: Set<string>): boolean => {
    const key = address(row);
    if (key === undefined) return true;
    output.add(key);
    return false;
  };
  const inspectHistory = (
    row: unknown,
    output: Set<string>,
    legacyAddresses: Set<string>,
  ): boolean => {
    if (!isObject(row)) return row === undefined || isPlaceholder(row);
    const role = field(row, 'role');
    if (role === unreadable) return true;
    if (role !== 'tool') return false;
    if (readResultDispositionMark(row) !== undefined) return true;
    const key = address(row);
    if (key === undefined) return true;
    if (key.startsWith('legacy:')) {
      if (legacyAddresses.has(key)) return true;
      legacyAddresses.add(key);
    }
    output.add(key);
    return false;
  };
  const inspectSettlement = (row: unknown, output: Set<string>): boolean => {
    if (!isObject(row)) return true;
    const delivery = field(row, 'delivery');
    const execution = field(row, 'execution');
    if (delivery === 'native') return execution !== 'returned' || inspectResult(row, output);
    return (
      delivery !== undefined ||
      (execution !== 'not-entered' && execution !== 'threw' && execution !== 'returned-unserved')
    );
  };
  const inspectEvidence = (state: unknown, committed: boolean): boolean => {
    if (state === undefined) return false;
    if (!isObject(state)) return true;
    const decisions = field(state, 'middlewareDecisions');
    if (decisions !== undefined) {
      if (scan(decisions, (row) => inspectDecision(row, committed))) return true;
      if (committed) committedDecisionLedger = true;
    }
    const results = committed ? committedResults : observedResults;
    const history = field(state, 'history');
    if (history !== undefined) {
      const legacyAddresses = new Set<string>();
      if (scan(history, (row) => inspectHistory(row, results, legacyAddresses))) return true;
    }
    const settlements = field(state, 'settledToolCalls');
    if (settlements !== undefined && scan(settlements, (row) => inspectSettlement(row, results)))
      return true;
    // Host observations can outlive the evidence that says what was admitted.
    for (const key of ['coverageDeclared', 'toolResults']) {
      const observations = field(state, key);
      if (
        observations !== undefined &&
        scan(observations, (row) => !isObject(row) || inspectResult(row, observedResults))
      )
        return true;
    }
    if (field(state, 'lastToolResult') !== undefined) observedUnkeyedResult = true;
    return false;
  };
  const inspectCommit = (value: unknown): boolean => {
    if (!isObject(value)) return true;
    const overwrite = field(value, 'overwrite');
    const updates = field(value, 'updates');
    if (inspectEvidence(overwrite, true) || inspectEvidence(updates, true)) return true;
    return scan(field(value, 'trace'), (row) => {
      if (!isObject(row)) return true;
      const path = field(row, 'path');
      if (typeof path !== 'string' || path.length > 4096) return true;
      const [root, child] = pathSegments(path);
      const key = evidenceKeys.find((candidate) => candidate === root);
      if (key === undefined) return false;
      // An unrecognised partial write cannot prove the decision was unchanged.
      // Whole-list append tails have already been inspected like overwrites.
      const verb = field(row, 'verb');
      return (
        child !== undefined ||
        (verb !== 'set' && verb !== 'append') ||
        !isObject(overwrite) ||
        field(overwrite, key) === undefined
      );
    });
  };
  const inspectEvent = (row: unknown): boolean => {
    if (!isObject(row)) return true;
    const type = field(row, 'type');
    if (type === unreadable) return true;
    if (type === 'agentfootprint.middleware.decision')
      return inspectDecision(field(row, 'payload'), false);
    if (!resultEvents.has(type)) return false;
    const payload = field(row, 'payload');
    if (!isObject(payload)) return true;
    if (type === 'agentfootprint.stream.tool_end' && didNotDispatch(payload)) return false;
    return inspectResult(payload, observedResults);
  };

  try {
    const snapshot = field(artifacts, 'snapshot');
    if (!isObject(snapshot)) return true;
    const events = field(artifacts, 'events');
    if (
      // On resume the fold base is the detached checkpoint state. Earlier
      // history and its append-only decision ledger may exist only there.
      inspectEvidence(field(snapshot, 'initialState'), true) ||
      inspectEvidence(field(snapshot, 'sharedState'), false) ||
      (events !== undefined && scan(events, inspectEvent)) ||
      scan(field(snapshot, 'commitLog'), inspectCommit)
    )
      return true;
    for (const key of observedResults) {
      if (!committedResults.has(key) && !unchangedResults.has(key)) return true;
    }
    if (observedUnkeyedResult && committedResults.size === 0 && unchangedResults.size === 0)
      return true;
    // Older history has no stamp. A readable decision ledger is needed to
    // interpret that absence, even if the result itself was committed.
    for (const key of committedResults) {
      if (key.startsWith('legacy:') && !committedDecisionLedger) return true;
    }
    return false;
  } catch {
    return true;
  }
}
