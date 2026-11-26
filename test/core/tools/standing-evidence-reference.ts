import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CallOccurrenceKey } from '../../../src/lib/callOccurrence.js';
import type { RecordedToolSettlement } from '../../../src/core/agent/recordedCalls/settlement.js';

type EntryCommit = readonly [
  commitIndex: number,
  traceIndex: number,
  keys: readonly CallOccurrenceKey[],
];

interface StandingEvidenceAddition {
  readonly entryCommits: readonly EntryCommit[];
  readonly settlementCommits?: readonly (readonly [
    commitIndex: number,
    traceIndex: number,
    rows: readonly RecordedToolSettlement[],
  ])[];
  readonly returned?: readonly [commitIndex: number, historyIndex: number];
}

type StandingKey =
  | 'enteredToolCalls'
  | 'enteredToolCallsComplete'
  | 'settledToolCalls'
  | 'settledToolCallsComplete'
  | 'codeExecutionReceipt';

interface ReferenceCommit {
  overwrite: Partial<Record<StandingKey, unknown>> & {
    history?: { role: string; toolCallId?: string; toolResultExecution?: 'returned' }[];
  };
  trace: { path: string; verb: string }[];
}

const executionReceipt = { status: 'confirmed', callOccurrenceKey: [0, 0, 0, 1, 0] };
const executionReceiptWrites = [
  [17, 0, executionReceipt],
  [33, 1, { ...executionReceipt, terminal: true }],
] as const;

const referencePath = new URL('./reference/standing-evidence/additions.json', import.meta.url);
const additions = JSON.parse(readFileSync(referencePath, 'utf8')) as Record<
  string,
  StandingEvidenceAddition
>;
export const standingEvidenceCases = Object.keys(additions).sort();

function insertWrite(
  commit: ReferenceCommit | undefined,
  traceIndex: number,
  path: StandingKey,
  verb: 'set' | 'append',
  value: unknown,
  name: string,
): void {
  assert(commit, name);
  assert(!Object.hasOwn(commit.overwrite, path), name);
  assert(!commit.trace.some((write) => write.path === path), name);
  assert(
    Number.isInteger(traceIndex) && traceIndex >= 0 && traceIndex <= commit.trace.length,
    name,
  );
  commit.overwrite[path] = value;
  commit.trace.splice(traceIndex, 0, { path, verb });
}

/** Apply only the audited committed additions to a freshly reconstructed expected record. */
export function withStandingEvidence(reference: unknown, name: string): unknown {
  const { commitLog } = reference as { commitLog: readonly ReferenceCommit[] };
  if (name === 'agent-script-artifact') {
    // The scripted runner exits once. Its exact dispatch receipt is written at
    // settlement, then sealed at the final Route. The historical capture stays pinned.
    for (const [commit, trace, value] of executionReceiptWrites)
      insertWrite(commitLog[commit], trace, 'codeExecutionReceipt', 'set', value, name);
  }
  const addition = additions[name];
  if (addition === undefined) return reference;
  let previous: readonly CallOccurrenceKey[] = [];
  for (const [commitIndex, traceIndex, keys] of addition.entryCommits) {
    const commit = commitLog[commitIndex];
    const seed = keys.length === 0;
    assert.deepEqual(keys.slice(0, previous.length), previous, name);
    const appended = keys.slice(previous.length);
    // The historical capture specified the whole prefix. Its exact suffix is
    // the newly recorded append operand, even on the first resumed commit.
    insertWrite(
      commit,
      traceIndex,
      'enteredToolCalls',
      seed ? 'set' : 'append',
      appended.map((callOccurrenceKey) => ({ callOccurrenceKey, entered: true })),
      name,
    );
    if (seed) insertWrite(commit, traceIndex + 1, 'enteredToolCallsComplete', 'set', true, name);
    previous = keys;
  }
  assert.equal(addition.settlementCommits !== undefined, name === 'agent-answer-layer');
  for (const [commitIndex, traceIndex, rows] of addition.settlementCommits ?? []) {
    const commit = commitLog[commitIndex];
    const seed = rows.length === 0;
    insertWrite(commit, traceIndex, 'settledToolCalls', seed ? 'set' : 'append', rows, name);
    if (seed) insertWrite(commit, traceIndex + 1, 'settledToolCallsComplete', 'set', true, name);
  }
  assert.equal(addition.returned !== undefined, name === 'agent-answer-layer');
  if (addition.returned !== undefined) {
    const [commitIndex, historyIndex] = addition.returned;
    const tool = commitLog[commitIndex]?.overwrite.history?.[historyIndex];
    assert(tool?.role === 'tool' && tool.toolCallId === 'c1', name);
    assert(!Object.hasOwn(tool, 'toolResultExecution'), name);
    tool.toolResultExecution = 'returned';
  }
  return reference;
}

/** Verify both new writes before checking the original default-standing digest. */
export function withoutExecutionReceipt<T>(reference: T, name: string): T {
  if (name !== 'agent-script-artifact') return reference;
  const { commitLog } = reference as { commitLog: readonly ReferenceCommit[] };
  for (const [commitIndex, , value] of executionReceiptWrites) {
    const commit = commitLog[commitIndex];
    assert(commit, name);
    assert.deepEqual(commit.overwrite.codeExecutionReceipt, value, name);
    const traceIndex = commit.trace.findIndex(({ path }) => path === 'codeExecutionReceipt');
    assert.deepEqual(commit.trace[traceIndex], { path: 'codeExecutionReceipt', verb: 'set' }, name);
    delete commit.overwrite.codeExecutionReceipt;
    commit.trace.splice(traceIndex, 1);
  }
  return reference;
}
