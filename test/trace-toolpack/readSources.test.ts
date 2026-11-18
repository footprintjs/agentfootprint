import type { CommitBundle } from 'foottrace';
import type { RuntimeSnapshot } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { traceVariable, variableToBacktrackTrace } from '../../src/debug.js';
import { callTraceTool, traceToolpack } from '../../src/observe.js';

const readerId = 'read#2';

function quoteSnapshot(
  window: Pick<CommitBundle, 'beganAt' | 'sawUntil'> = {},
  { readKey = 'quote', keepReader = true } = {},
): RuntimeSnapshot {
  const quoteWrite = (idx: number, stageId: string, quote: string): CommitBundle => ({
    idx,
    stage: stageId,
    stageId,
    runtimeStageId: `${stageId}#${idx}`,
    trace: [{ path: 'quote', verb: 'set', readKeys: [] }],
    redactedPaths: [],
    overwrite: { quote },
    updates: {},
  });
  const commitLog = [quoteWrite(0, 'first', 'original'), quoteWrite(1, 'second', 'updated')];
  if (keepReader) {
    commitLog.push({
      idx: 2,
      stage: 'read',
      stageId: 'read',
      runtimeStageId: readerId,
      trace: [{ path: 'answer', verb: 'set', readKeys: [readKey] }],
      redactedPaths: [],
      overwrite: { answer: 'received a quote' },
      updates: {},
      ...window,
    });
  }
  return {
    runId: 'read-window-fixture',
    commitLog,
    commitValues: 'full',
    writeProvenance: 'reads-prefix',
    sharedState: {},
    executionTree: {
      id: 'read',
      runtimeStageId: readerId,
      stageReads: { [readKey]: 'original' },
      logs: {},
      errors: {},
      metrics: {},
      evals: {},
    },
  };
}

function readNode(snapshot: RuntimeSnapshot): Promise<string> {
  return callTraceTool(traceToolpack({ snapshot }), 'trace_node', { runtimeStageId: readerId });
}

describe('trace_node read sources', () => {
  it('names the pinned writer even when a sibling overwrote it before the reader committed', async () => {
    const out = await readNode(quoteSnapshot({ beganAt: 1 }));
    expect(out).toContain('- data: quote ← first#0 "first"');
    expect(out).not.toContain('second#1');
    expect(out).not.toContain('possible sources');
  });

  it('uses the reader’s first bundle when the step also committed a continuation', async () => {
    const snapshot = quoteSnapshot({ beganAt: 1 });
    snapshot.commitLog.push({
      ...snapshot.commitLog[2],
      idx: 3,
      phase: 'repeat',
      beganAt: undefined,
      trace: [],
      overwrite: {},
    });
    const out = await readNode(snapshot);
    expect(out).toContain('- data: quote ← first#0 "first"');
    expect(out).not.toContain('second#1');
  });

  it('names every overlapping writer as possible and gives each its Foottrace code', async () => {
    const out = await readNode(quoteSnapshot({ beganAt: 1, sawUntil: 2 }));
    expect(out).toContain('- data: quote ← possible sources');
    expect(out).toMatch(/first#0[^\n]*replaced-while-running/);
    expect(out).toMatch(/second#1[^\n]*written-while-running/);
  });

  it('retains the before-commit lookup for an unstamped recording', async () => {
    const out = await readNode(quoteSnapshot());
    expect(out).toContain('- data: quote ← second#1 "second"');
    expect(out).not.toContain('first#0');
    expect(out).not.toContain('possible sources');
  });

  it('leaves the reason unknown when a sibling redacts the key after the read window', async () => {
    const snapshot = quoteSnapshot({ beganAt: 1 });
    const [first, sibling] = snapshot.commitLog;
    snapshot.commitLog[0] = { ...first, trace: [], overwrite: {} };
    snapshot.commitLog[1] = { ...sibling, trace: [], overwrite: {}, redactedPaths: ['quote'] };
    const out = await readNode(snapshot);
    expect(out).toContain(
      "- data: quote ← (no tracked writer; reason not recorded for this read's window)",
    );
    expect(out).not.toMatch(/redacted|never-written|second#1/);
  });

  it('leaves the reason unknown when a redaction precedes the window and a write follows it', async () => {
    const snapshot = quoteSnapshot({ beganAt: 1 });
    const [first] = snapshot.commitLog;
    snapshot.commitLog[0] = { ...first, trace: [], overwrite: {}, redactedPaths: ['quote'] };
    const out = await readNode(snapshot);
    expect(out).toContain(
      "- data: quote ← (no tracked writer; reason not recorded for this read's window)",
    );
    expect(out).not.toMatch(/redacted|never-written|second#1/);
  });

  it('keeps the Foottrace absence codes for unstamped reads', async () => {
    const snapshot = quoteSnapshot({}, { readKey: 'untouched' });
    expect(await readNode(snapshot)).toContain(
      '- data: untouched ← (no tracked writer ⚠ never-written)',
    );
    snapshot.commitLog[1].redactedPaths = ['untouched'];
    expect(await readNode(snapshot)).toContain(
      '- data: untouched ← (no tracked writer ⚠ redacted)',
    );
  });

  it('bounds a wide window, keeps the before candidate and counts the omitted possibilities', async () => {
    const writerCount = 256;
    const snapshot = quoteSnapshot({ beganAt: 1, sawUntil: writerCount });
    const [first, during, reader] = snapshot.commitLog;
    const overlappingWriters = Array.from({ length: writerCount - 1 }, (_, offset) => {
      const idx = offset + 1;
      return { ...during, idx, runtimeStageId: `second#${idx}` };
    });
    snapshot.commitLog = [first, ...overlappingWriters, { ...reader, idx: writerCount }];
    const out = await readNode(snapshot);
    expect(out).toContain('- data: quote ← possible sources:');
    expect(out).toMatch(/first#0[^\n]*replaced-while-running/);
    expect(out).toMatch(/second#1[^\n]*written-while-running/);
    const displayed = out.split('\n').filter((line) => /^ {2}- (first|second)#/.test(line));
    expect(displayed).toHaveLength(8);
    expect(out).toContain('…and 248 more possible sources (output capped)');
  });

  it('distinguishes no tracked writer from a missing reader bundle', async () => {
    const none = await readNode(quoteSnapshot({ beganAt: 1 }, { readKey: 'untouched' }));
    expect(none).toContain('- data: untouched ← (no tracked writer');
    const unknown = await readNode(quoteSnapshot({}, { keepReader: false }));
    expect(unknown).toContain('- data: quote ← (source not recorded');
    expect(unknown).not.toContain('second#1');
  });

  it('reports missing read attribution when only the continuation was retained', async () => {
    const snapshot = quoteSnapshot();
    snapshot.commitLog[2].phase = 'repeat';
    const out = await readNode(snapshot);
    expect(out).toContain('- data: quote ← (source not recorded');
    expect(out).not.toContain('second#1');
  });

  it('keeps the possible pre-run source when the first writer is inside the window', async () => {
    const out = await readNode(quoteSnapshot({ beganAt: 0, sawUntil: 2 }));
    expect(out).toMatch(/no tracked writer[^\n]*replaced-while-running/);
    expect(out).toMatch(/first#0[^\n]*written-while-running/);
    expect(out).toMatch(/second#1[^\n]*written-while-running/);
  });
});

describe('recorded variable life', () => {
  it('preserves overlapping read sources even when forward edges carry per-write provenance', () => {
    const life = traceVariable({ snapshot: quoteSnapshot({ beganAt: 1, sawUntil: 2 }) }, 'quote');
    expect(life.coverage).toBe('exact');
    expect(life.moments.filter((moment) => moment.kind === 'read')).toMatchObject([
      { runtimeStageId: readerId, fromWriteIdx: 0, orWriteIdxs: [1] },
    ]);
  });

  it('puts the possible read in each candidate’s custody and lists both on its timeline', () => {
    const life = traceVariable({ snapshot: quoteSnapshot({ beganAt: 1, sawUntil: 2 }) }, 'quote');
    const board = variableToBacktrackTrace(life, { answer: { text: 'received a quote' } });
    const reads = board.trail?.custody.filter((hop) => hop.step === 'read');
    expect(reads).toHaveLength(1);
    expect(reads?.[0].detail).toMatch(/possible sources: commit 0 or commit 1/);
    for (const [id, idx] of [
      ['first#0', 0],
      ['second#1', 1],
    ] as const) {
      const card = board.suspects.find((suspect) => suspect.bornAt?.id === id);
      expect(card?.custody).toContainEqual({
        step: 'read',
        at: readerId,
        detail: expect.stringContaining(`possible source: commit ${idx}`),
        variable: 'quote',
      });
    }
  });

  it('lists the possible pre-run source on the timeline', () => {
    const life = traceVariable({ snapshot: quoteSnapshot({ beganAt: 0, sawUntil: 2 }) }, 'quote');
    const board = variableToBacktrackTrace(life, { answer: { text: 'received a quote' } });
    const read = board.trail?.custody.find((hop) => hop.step === 'read');
    expect(read?.detail).toMatch(/possible sources: before the run or commit 0 or commit 1/);
  });
});
