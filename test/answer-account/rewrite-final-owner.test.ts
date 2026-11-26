/** Final attribution requires the last changing decision, not the last readable name. */
import { describe, expect, it } from 'vitest';
import { Agent, allow, defineTool } from '../../src/index.js';
import { accountForAnswer } from '../../src/answer-account/account.js';
import { mock } from '../../src/llm-providers.js';
import { callTraceTool, recordRun, traceToolpack, type Recording } from '../../src/observe.js';
import { REDACTION_MARKER_ID } from '../../src/redaction/marker.js';

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

/** The account TELLS the call, and names no final changer and no decision pointer for it. */
function expectUnattributed(recording: Recording) {
  const account = accountForAnswer(recording, {});
  expect(account.answer.status).toBe('recorded');
  const call = account.facts.calls[0];
  expect(call?.toolName).toBe('lookup');
  expect(call?.rewrittenBy).toBeUndefined();
  expect(
    call?.pointers.filter(
      (pointer) => pointer.kind === 'state' && pointer.key === 'middlewareDecisions',
    ),
  ).toEqual([]);
}

/**
 * Under any redaction policy the served copy masks the provider's tool-call ids, so on a run
 * that called a tool the account declines as a whole (`account.ts · notToldAccount`, cause
 * `kept-out`), as it already did before rewrite attribution existed. Pin what the person reads.
 */
function expectDeclined(recording: Recording) {
  const account = accountForAnswer(recording, {});
  expect(account.answer).toMatchObject({ status: 'not-recorded', missing: 'redacted' });
  expect(account.summary.sentence).toMatchObject({
    template: { id: 'scope.keptOut' },
    text: 'This record keeps out values this report reads, so nothing about the answer can be told from it.',
  });
  expect(account.facts.calls).toEqual([]);
}

/**
 * A served record whose provider ids are readable: the redaction marker of a real redacted run
 * grafted onto an unredacted recording, so the account tells and its kept-out guards apply.
 */
async function servedButTold() {
  const marker = (
    (await run(['0.why'])).snapshot as unknown as { recorders: { id: string }[] }
  ).recorders.find((row) => row.id === REDACTION_MARKER_ID);
  expect(marker).toBeDefined();
  const recording = await run();
  const snapshot = recording.snapshot as unknown as { recorders?: unknown[] };
  snapshot.recorders = [...(snapshot.recorders ?? []), marker];
  return recording;
}

/** Apply `edit` to the final changing row wherever the recording holds it (state and commit log). */
function everyFinalRow(
  recording: Recording,
  edit: (row: Record<string, unknown>, at: unknown[], i: number) => void,
) {
  let edited = 0;
  const walk = (value: unknown) => {
    if (Array.isArray(value))
      value.forEach((item, i) => {
        const row = item as Record<string, unknown> | null;
        if (
          row?.middleware === 'final-rule' &&
          row.changed === true &&
          row.moment === 'after-tool'
        ) {
          edit(row, value, i);
          edited++;
        } else walk(item);
      });
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(recording.snapshot);
  expect(edited).toBeGreaterThan(0);
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
      expectDeclined(recording);
      expect(await inspect(recording)).not.toContain('rewritten by:');
    },
  );

  it('a served record that tells still credits an intact final rule', async () => {
    const recording = await servedButTold();
    expect(read(recording)?.rewrittenBy).toBe('final-rule');
    expect(await inspect(recording)).toContain('rewritten by: "final-rule"');
  });

  it.each(['whole-row', 'key-only', 'name-only'] as const)(
    'a served record that tells withholds the final changer when its %s is kept out',
    async (shape) => {
      const recording = await servedButTold();
      everyFinalRow(recording, (row, at, i) => {
        if (shape === 'whole-row') at[i] = '[REDACTED]';
        else if (shape === 'key-only') row.callOccurrenceKey = '[REDACTED]';
        else row.middleware = '[REDACTED]';
      });
      expectUnattributed(recording);
      expect(await inspect(recording)).not.toContain('rewritten by:');
    },
  );

  it('a rewritten error notice of a failed call names no final changer in the account', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'lookup-1', name: 'lookup', args: {} }] }, 'Done.'],
      }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'lookup',
          description: 'Read the fixture.',
          inputSchema: { type: 'object' },
          execute: () => {
            throw new Error('backend down');
          },
        }),
      )
      .toolMiddleware({
        name: 'error-rule',
        onToolResult: ({ error }) =>
          error ? allow('The lookup is unavailable.', 'Soften the error.') : allow(),
      })
      .resultsLayer()
      .build();
    const recorder = recordRun(agent);
    try {
      await agent.run('Read the fixture');
      const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
      // The account judges results only for calls that ran; a failed call's notice is not one.
      expect(read(recording)).toMatchObject({ toolName: 'lookup', outcome: 'failed' });
      expect(read(recording)?.rewrittenBy).toBeUndefined();
      // The inspector reads the decision ledger itself and names the rule beside the error.
      const host = await inspect(recording);
      expect(host).toContain('rewritten by: "error-rule"');
      expect(host).toContain('outcome: error');
    } finally {
      recorder.stop();
      await agent.shutdown();
    }
  });

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
