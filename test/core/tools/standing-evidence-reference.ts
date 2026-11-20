import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CallOccurrenceKey } from '../../../src/lib/callOccurrence.js';

type EntryCommit = readonly [
  commitIndex: number,
  traceIndex: number,
  keys: readonly CallOccurrenceKey[],
];

interface StandingEvidenceAddition {
  readonly entryCommits: readonly EntryCommit[];
  readonly returned?: readonly [commitIndex: number, historyIndex: number];
}

interface ReferenceCommit {
  overwrite: {
    enteredToolCalls?: {
      complete: true;
      entries: { callOccurrenceKey: CallOccurrenceKey; entered: true }[];
    };
    history?: { role: string; toolCallId?: string; toolResultExecution?: 'returned' }[];
  };
  trace: { path: string; verb: string }[];
}

const referencePath = new URL('./reference/standing-evidence/additions.json', import.meta.url);
const additions = JSON.parse(readFileSync(referencePath, 'utf8')) as Record<
  string,
  StandingEvidenceAddition
>;
export const standingEvidenceCases = Object.keys(additions).sort();

/** Apply only the audited committed additions to a freshly reconstructed expected record. */
export function withStandingEvidence(reference: unknown, name: string): unknown {
  const addition = additions[name];
  if (addition === undefined) return reference;
  const { commitLog } = reference as { commitLog: readonly ReferenceCommit[] };
  for (const [commitIndex, traceIndex, keys] of addition.entryCommits) {
    const commit = commitLog[commitIndex];
    assert(commit, name);
    assert(!Object.hasOwn(commit.overwrite, 'enteredToolCalls'), name);
    assert(!commit.trace.some(({ path }) => path === 'enteredToolCalls'), name);
    assert(
      Number.isInteger(traceIndex) && traceIndex >= 0 && traceIndex <= commit.trace.length,
      name,
    );
    commit.overwrite.enteredToolCalls = {
      complete: true,
      entries: keys.map((callOccurrenceKey) => ({ callOccurrenceKey, entered: true })),
    };
    commit.trace.splice(traceIndex, 0, { path: 'enteredToolCalls', verb: 'set' });
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
