import { describe, expect, it } from 'vitest';
import { Agent, absent, coverage, defineTool } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import { mock } from '../../src/providers.js';
import { readGovernedRowset } from '../../src/core/agent/resultRowsets/read.js';

const spine = (value: unknown, path: readonly string[]): unknown =>
  path.reduceRight((child, key) => ({ [key]: child }), value);

describe('outer binding paths and selected row depth have separate native bounds', () => {
  it('preserves canonical absence through an actual coverage wrapper without a source fallback', async () => {
    const events: AgentfootprintEvent[] = [];
    const boundary = { checked: ['synthetic measurement'], notChecked: [], cannotCover: [] };
    const tool = defineTool({
      name: 'empty_source',
      description: 'Read an absent synthetic measurement.',
      resultRowsets: [
        {
          key: 'rows',
          columns: { amount: 'number' },
          source: { kind: 'inline', path: ['result', 'rows'] },
        },
      ],
      execute: () => coverage(absent({ what: 'synthetic measurement', ...boundary }), boundary),
    });
    const agent = Agent.create({
      model: 'mock',
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
      provider: mock({
        replies: [{ toolCalls: [{ id: 'absent', name: 'empty_source', args: {} }] }, 'Done.'],
      }),
    })
      .tool(tool)
      .build();
    agent.on('*', (event) => events.push(event));
    await agent.run({ message: 'Read absent fixture.' });
    expect(
      events
        .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
        .map((event) => event.payload),
    ).toMatchObject([
      { reason: 'declared-absence', disposition: 'not-applicable', delivery: 'unchanged' },
    ]);
    expect(
      events.filter((event) => event.type === 'agentfootprint.integrity.context_error'),
    ).toEqual([]);
  });
  it('checks a real rowset at the exact legal16-segment inline path', async () => {
    const path = Array.from({ length: 16 }, (_, index) => `level${index}`);
    const events: AgentfootprintEvent[] = [];
    let calls = 0;
    const tool = defineTool({
      name: 'deep_source',
      description: 'Read synthetic nested rows.',
      resultRowsets: [
        { key: 'deep', columns: { amount: 'number' }, source: { kind: 'inline', path } },
      ],
      execute: () => {
        calls++;
        return spine([{ amount: 0 }], path);
      },
    });
    const agent = Agent.create({
      model: 'mock',
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
      provider: mock({
        replies: [{ toolCalls: [{ id: 'deep', name: 'deep_source', args: {} }] }, 'Done.'],
      }),
    })
      .tool(tool)
      .build();
    agent.on('*', (event) => events.push(event));
    await agent.run({ message: 'Read nested fixture.' });
    expect(calls).toBe(1);
    expect(
      events
        .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
        .map((event) => event.payload),
    ).toMatchObject([{ rowset: 'deep', reason: 'rows', disposition: 'checked-pass' }]);
    expect(
      events.filter((event) => event.type === 'agentfootprint.integrity.context_error'),
    ).toEqual([]);
  });

  it('allows the native content envelope in addition to the exact declared path', async () => {
    const path = Array.from({ length: 16 }, (_, index) => `level${index}`);
    const result = await readGovernedRowset(
      { key: 'deep', columns: { amount: 'number' }, source: { kind: 'inline', path } },
      { content: spine([{ amount: 0 }], path), effects: [], status: 'success' },
      undefined,
      undefined,
      () => true,
    );
    expect(result).toMatchObject({
      available: true,
      reason: 'rows',
      reading: { rows: [{ amount: 0 }] },
    });
  });

  it('still rejects selected row data beyond16 levels, even when the outer budget permits the path', async () => {
    const path = ['outer'];
    let nested: unknown = 0;
    for (let index = 0; index < 15; index++) nested = { child: nested };
    const result = await readGovernedRowset(
      { key: 'rows', columns: { amount: 'number' }, source: { kind: 'inline', path } },
      spine([{ amount: nested }], path),
      undefined,
      undefined,
      () => true,
    );
    expect(result).toEqual({ available: false, reason: 'source-over-bound' });
  });
});
