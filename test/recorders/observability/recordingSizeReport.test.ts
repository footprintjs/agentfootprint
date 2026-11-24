import { describe, expect, it } from 'vitest';

import { Agent, defineTool, recordingPutInput } from '../../../src/index.js';
import {
  recordingSizeReport,
  recordRun,
  type Recording,
  type RecordingSizeReport,
} from '../../../src/observe.js';
import { mock } from '../../../src/providers.js';

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

function recording(
  snapshot: unknown,
  events: readonly unknown[] = [],
  structure?: unknown,
): Recording {
  return { snapshot, events: events as Recording['events'], structure };
}

function expectTotals(report: RecordingSizeReport, record: Recording): void {
  expect(report.bytes).toBe(bytesOf(record));
  expect(report.bytes).toBe(
    (report.snapshot?.bytes ?? 0) +
      report.events.bytes +
      (report.structure?.bytes ?? 0) +
      report.framingBytes,
  );
  expect(report.events.bytes).toBe(bytesOf(record.events));
  expect(report.events.bytes).toBe(
    report.events.types.reduce((sum, row) => sum + row.bytes, report.events.framingBytes),
  );
  expect(report.events.types.reduce((sum, row) => sum + row.count, 0)).toBe(record.events.length);
  for (const fields of [report.snapshot, report.snapshot?.sharedState]) {
    if (fields !== undefined) {
      expect(fields.bytes).toBe(
        fields.fields.reduce((sum, row) => sum + row.bytes, fields.framingBytes),
      );
    }
  }
}

async function savedToolRun(boundaryDetail: 'full' | 'lean'): Promise<string> {
  const tool = defineTool<{ label: string }, { result: string }>({
    name: 'lookup',
    description: 'Read fixture data.',
    inputSchema: { type: 'object', properties: { label: { type: 'string' } } },
    execute: ({ label }) => ({ result: `SECRETA-result-${label}` }),
  });
  const runner = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'first', name: 'lookup', args: { label: 'SECRETA-arg-λ' } }] },
        { toolCalls: [{ id: 'second', name: 'lookup', args: { label: 'SECRETA-arg-𐐀' } }] },
        { content: 'SECRETA-answer' },
      ],
    }),
    model: 'mock',
    reactMode: 'dynamic-grouped',
  })
    .tool(tool)
    .build();
  const recorder = recordRun(runner, { boundaryDetail });
  try {
    await runner.run({ message: 'SECRETA-prompt\nSay "hello" to 🌲.' });
    const { data } = recordingPutInput(recorder.toRecording());
    if (typeof data !== 'string') throw new Error('Expected the stored recording as JSON text.');
    return data;
  } finally {
    recorder.stop();
    await runner.shutdown();
  }
}

describe('recordingSizeReport', () => {
  it('distinguishes an omitted pre-run snapshot from an empty event list', () => {
    const record = recording(undefined);
    const report = recordingSizeReport(record);
    expect(report.snapshot).toBeUndefined();
    expect(report.structure).toBeUndefined();
    expect(report.events).toEqual({ bytes: 2, framingBytes: 2, count: 0, types: [] });
    expectTotals(report, record);
  });

  it('accounts for escaped UTF-8 fields, nested shared state, event types and structure', () => {
    const known = { type: 'agentfootprint.agent.turn_start', payload: { text: '𐐀\u0000' } };
    const unknown = [
      { type: 'SECRETA-unknown-one', payload: { value: '\n' } },
      { type: 'SECRETA-unknown-two', payload: { value: '🌲' } },
    ];
    const sharedState = { 'state "λ"': ['🌲', '\udead'], empty: {} };
    const legacySubflows = { 'sf-old': { output: 'SECRETA-output' } };
    const snapshot = {
      sharedState,
      'escaped "λ"': null,
      runId: 'SECRETA-run',
      subflowResults: legacySubflows,
    };
    const structure = { id: 'seed', name: 'Init λ', type: 'stage' };
    const record = recording(snapshot, [unknown[0], known, unknown[1], known], structure);
    const report = recordingSizeReport(record);

    expectTotals(report, record);
    expect(report.snapshot?.bytes).toBe(bytesOf(snapshot));
    expect(report.snapshot?.fields).toEqual(
      expect.arrayContaining([
        { name: 'escaped "λ"', bytes: 4, count: 1 },
        { name: 'sharedState', bytes: bytesOf(sharedState), count: 2 },
      ]),
    );
    expect(report.snapshot?.sharedState).toEqual(
      expect.objectContaining({
        bytes: bytesOf(sharedState),
        fields: expect.arrayContaining([
          { name: 'state "λ"', bytes: bytesOf(sharedState['state "λ"']), count: 2 },
          { name: 'empty', bytes: 2, count: 0 },
        ]),
      }),
    );
    expect(report.events.count).toBe(4);
    expect(report.events.types).toHaveLength(2);
    expect(report.events.types).toEqual(
      expect.arrayContaining([
        { name: known.type, bytes: 2 * bytesOf(known), count: 2 },
        { name: 'other', bytes: unknown.reduce((sum, event) => sum + bytesOf(event), 0), count: 2 },
      ]),
    );
    expect(report.snapshot?.subflows?.entries).toEqual([
      {
        name: 'sf-old',
        bytes: bytesOf(legacySubflows['sf-old']),
        count: 1,
        kind: 'path-alias',
        commitCount: null,
      },
    ]);
    expect(report.structure).toEqual({ bytes: bytesOf(structure), count: 1 });
    expect(
      recordingSizeReport(recording({}, [], { unsupported: true })).structure?.count,
    ).toBeNull();
    expect(JSON.stringify(report)).not.toContain('SECRETA-');
  });

  it.each(['full', 'lean'] as const)(
    'measures a native %s saved run and each stored mount entry',
    async (detail) => {
      const saved = await savedToolRun(detail);
      const record = JSON.parse(saved) as Recording;
      const report = recordingSizeReport(record);
      const snapshot = record.snapshot as {
        subflowResults: Record<string, { treeContext?: { history?: unknown[] } }>;
      };
      const subflows = report.snapshot?.subflows;
      if (subflows === undefined)
        throw new Error('Expected subflow data on the native grouped run.');

      expectTotals(report, record);
      expect(report.bytes).toBe(Buffer.byteLength(saved, 'utf8'));
      expect(report.snapshot?.bytes).toBe(bytesOf(snapshot));
      expect(report.structure?.count).toBeGreaterThan(0);
      expect(subflows.bytes).toBe(bytesOf(snapshot.subflowResults));
      expect(subflows.bytes).toBe(
        subflows.entries.reduce((sum, row) => sum + row.bytes, subflows.framingBytes),
      );
      expect(subflows.entries.map(({ name }) => name).sort()).toEqual(
        Object.keys(snapshot.subflowResults).sort(),
      );
      expect(
        subflows.entries.filter(
          ({ kind, name }) => kind === 'mount' && name.startsWith('sf-llm-call#'),
        ),
      ).toHaveLength(3);
      expect(subflows.entries).toContainEqual(
        expect.objectContaining({ name: 'sf-llm-call', kind: 'path-alias' }),
      );
      for (const row of subflows.entries) {
        const captured = snapshot.subflowResults[row.name];
        expect(row.bytes).toBe(bytesOf(captured));
        expect(row.commitCount).toBe(captured?.treeContext?.history?.length ?? null);
      }

      if (detail === 'full') {
        expect(
          ['SECRETA-prompt', 'SECRETA-arg', 'SECRETA-result'].every((marker) =>
            saved.includes(marker),
          ),
        ).toBe(true);
        const paired = saved.replaceAll('SECRETA-', 'SECRETB-');
        expect(paired).not.toBe(saved);
        expect(recordingSizeReport(JSON.parse(paired) as Recording)).toEqual(report);
      }
      expect(JSON.stringify(report)).not.toContain('SECRETA-');
    },
  );

  it('refuses malformed, circular, accessor and overdeep values without leaking them', () => {
    const circular: { nested?: unknown } = {};
    circular.nested = circular;
    let getterReads = 0;
    const getter = {
      get secret() {
        getterReads++;
        return 'SECRETA-getter';
      },
    };
    const deep = Array.from({ length: 256 }).reduce<object>((nested) => ({ nested }), {});
    for (const value of [circular, getter, { nested: new Date(0) }, { nested: 1n }, deep]) {
      expect(() => recordingSizeReport(recording({ 'SECRETA-key': value }))).toThrow(
        /^(?!.*SECRETA-).*plain recording JSON/,
      );
    }
    expect(getterReads).toBe(0);
  });

  it('refuses a string that cannot fit in the diagnostic budget', () => {
    const oversized = 'x'.repeat(64 * 1024 * 1024);
    expect(() => recordingSizeReport(recording({ oversized }))).toThrow(/within 64 MiB/);
  });

  it('bounds the number and length of names without truncating an identity', () => {
    const fields = Object.fromEntries(Array.from({ length: 16_384 }, (_, id) => [id, null]));
    expect(() => recordingSizeReport(recording({ sharedState: fields }))).toThrow(/names table/);
    expect(() => recordingSizeReport(recording({ ['x'.repeat(1025)]: 0 }))).toThrow(/names table/);
  });

  it('measures a plain recording over Neo’s 16 MiB viewer cap', () => {
    const body = 'x'.repeat(1024 * 1024);
    const history = Array.from({ length: 17 }, () => body);
    const record = recording({ history });
    const report = recordingSizeReport(record);
    const valueBytes = history.length * (body.length + 2) + (history.length - 1) + 2;

    expect(report.bytes).toBeGreaterThan(16 * 1024 * 1024);
    expect(report.snapshot?.fields).toEqual([{ name: 'history', bytes: valueBytes, count: 17 }]);
    expect(report.bytes).toBe(
      valueBytes + Buffer.byteLength('{"snapshot":{"history":},"events":[]}'),
    );
  });
});
