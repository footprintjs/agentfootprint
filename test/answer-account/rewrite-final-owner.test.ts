/** Final attribution requires the last changing decision, not the last readable name. */
import { describe, expect, it } from 'vitest';
import { Agent, allow, defineTool } from '../../src/index.js';
import { accountForAnswer } from '../../src/answer-account/account.js';
import { mock } from '../../src/llm-providers.js';
import { callTraceTool, recordRun, traceToolpack, type Recording } from '../../src/observe.js';

async function run(decisionPaths?: string[]) {
  const agent = Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'lookup-1', name: 'lookup', args: {} }] }, 'Done.'],
    }),
    model: 'mock',
    ...(decisionPaths && { redact: { fields: { middlewareDecisions: decisionPaths } } }),
  })
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Read the fixture.',
        inputSchema: { type: 'object' },
        execute: () => [{ fixture: 'original' }],
      }),
    )
    .toolMiddleware({
      name: 'final-rule',
      onToolResult: () => allow([{ fixture: 'final' }], 'Final fixture projection.'),
    })
    .toolMiddleware({
      name: 'first-rule',
      onToolResult: () => allow([{ fixture: 'first' }], 'First fixture projection.'),
    })
    .resultsLayer()
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run('Read the fixture');
    return JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

function decisions(recording: Recording): unknown[] {
  return (recording.snapshot.sharedState as { middlewareDecisions: unknown[] }).middlewareDecisions;
}

function finalDecision(recording: Recording) {
  const rows = decisions(recording);
  const index = rows.findIndex(
    (row) =>
      row !== null &&
      typeof row === 'object' &&
      (row as Record<string, unknown>).middleware === 'final-rule' &&
      (row as Record<string, unknown>).changed === true,
  );
  expect(index).toBeGreaterThan(0);
  return { index, row: rows[index] as Record<string, unknown> };
}

async function inspect(recording: Recording) {
  return String(
    await callTraceTool(
      traceToolpack(recording, { showWithheldResults: true }),
      'inspect_tool_call',
      {
        toolCallId: 'lookup-1',
      },
    ),
  );
}

function read(recording: Recording) {
  return accountForAnswer(recording, {}).facts.calls[0];
}

function expectUnattributed(recording: Recording) {
  const call = read(recording);
  expect(call?.rewrittenBy).toBeUndefined();
  expect(
    call?.pointers.filter(
      (pointer) => pointer.kind === 'state' && pointer.key === 'middlewareDecisions',
    ) ?? [],
  ).toEqual([]);
}

describe('final rewrite ownership across unavailable decisions', () => {
  it('credits the intact final rule and its original decision pointer', async () => {
    const recording = await run();
    const { index } = finalDecision(recording);
    expect(read(recording)?.rewrittenBy).toBe('final-rule');
    expect(read(recording)?.pointers).toContainEqual({
      kind: 'state',
      key: 'middlewareDecisions',
      path: `/${index}/middleware`,
    });
    expect(await inspect(recording)).toContain('rewritten by: "final-rule"');
    expect(await inspect(recording)).not.toContain('rewritten by: "first-rule"');
  });

  it.each(['whole-row', 'key-only'] as const)(
    'withholds attribution after scoped %s redaction of the final decision',
    async (shape) => {
      const original = await run();
      const { index } = finalDecision(original);
      const recording = await run([
        String(index) + (shape === 'key-only' ? '.callOccurrenceKey' : ''),
      ]);
      const hidden = decisions(recording)[index];
      const value =
        shape === 'key-only' ? (hidden as Record<string, unknown>).callOccurrenceKey : hidden;
      expect(['REDACTED', '[REDACTED]']).toContain(value);
      expectUnattributed(recording);
      expect(await inspect(recording)).not.toContain('rewritten by:');
    },
  );

  it.each(['absent', 'malformed'] as const)(
    'an imported %s final occurrence key cannot credit an earlier rule',
    async (shape) => {
      const recording = await run();
      const { row } = finalDecision(recording);
      expect(read(recording)?.rewrittenBy).toBe('final-rule');
      if (shape === 'absent') delete row.callOccurrenceKey;
      else row.callOccurrenceKey = [1];
      expectUnattributed(recording);
    },
  );

  it('a retained final owner remains attributable after an earlier unplaced decision', async () => {
    const recording = await run();
    const first = decisions(recording).find(
      (row) =>
        row !== null &&
        typeof row === 'object' &&
        (row as Record<string, unknown>).middleware === 'first-rule' &&
        (row as Record<string, unknown>).changed === true,
    ) as Record<string, unknown>;
    expect(first).toBeDefined();
    delete first.callOccurrenceKey;
    const { index } = finalDecision(recording);
    expect(read(recording)?.rewrittenBy).toBe('final-rule');
    expect(read(recording)?.pointers).toContainEqual({
      kind: 'state',
      key: 'middlewareDecisions',
      path: `/${index}/middleware`,
    });
    expect(await inspect(recording)).toContain('rewritten by: "final-rule"');
  });
});
