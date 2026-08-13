/**
 * The code leg (9.22.0, Leg 4): when a store is attached, files a code run
 * hands back IN-BAND (`CodeResult.artifacts[].data`) are minted under the
 * run's scope — kind `file/<ext>` from the producer's own filename — and
 * the rendered result names the ref, so the model routes the file instead
 * of asking for its bytes. Entries without `data` stay described-only.
 * Staging-in is deliberately absent this phase (the port's only input is
 * the code string) — mint-on-output only, stated in the module.
 *
 * Sections: Functional (mint + rendered ref + events) · Integration (the
 * minted file consumed by a wants-tool) · Regression (no store ⇒ rendered
 * line byte-identical to 9.21.0; data-less entries never minted).
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  codeRunnerTool,
  inMemoryArtifacts,
  type AgentfootprintEvent,
  type CodeResult,
  type CodeRunner,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

type Caught = { name: string; payload: Record<string, unknown> };
const artifactCapture = (agent: Agent) => {
  const events: Caught[] = [];
  agent.on('agentfootprint.artifacts.*', (e: AgentfootprintEvent) => {
    events.push({ name: e.type, payload: e.payload as Record<string, unknown> });
  });
  return events;
};

/** A runner whose session "produces" the given artifacts. */
const runnerProducing = (artifacts: NonNullable<CodeResult['artifacts']>): CodeRunner => ({
  id: 'test-code-runner',
  start: async () => ({
    id: 'session-1',
    execute: async () => ({
      ok: true,
      stdout: 'computed 3 aggregates',
      stderr: '',
      artifacts,
    }),
    stop: async () => undefined,
  }),
});

const CSV = 'region,total\nwest,42\neast,17\n';

describe('functional — files the run produced become tickets', () => {
  it('mints data-carrying entries (kind file/<ext>, label = filename) and renders the ref', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ replies: [call('run_code', 't1', { code: 'x' }), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(
        codeRunnerTool({
          runner: runnerProducing([
            { name: 'report.csv', bytes: CSV.length, data: CSV },
            // Described-only: bytes never left the sandbox — no mint.
            { name: 'huge.parquet', bytes: 9_000_000, uri: 's3://bucket/huge.parquet' },
          ]),
        }),
      )
      .build();
    const events = artifactCapture(agent);
    const ends: Record<string, unknown>[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      ends.push(e.payload as Record<string, unknown>),
    );
    await agent.run({ message: 'go' }, { sessionId: 'code' });

    const minted = events.filter((e) => e.name === 'agentfootprint.artifacts.minted');
    expect(minted).toHaveLength(1);
    expect(minted[0].payload).toMatchObject({
      kind: 'file/csv',
      mediaType: 'text/csv',
      bytes: CSV.length,
      label: 'report.csv',
      tool: 'run_code',
    });
    expect(minted[0].payload.origin).toMatchObject({ toolCallId: 't1' });

    const text = String(ends[0].result);
    expect(text).toContain('computed 3 aggregates');
    // The minted line names the ref and teaches the routing move…
    expect(text).toMatch(/\[artifact: report\.csv, 29 bytes, stored as art_[A-Za-z0-9]+/);
    expect(text).toContain('route this ref');
    // …the described-only line is exactly the 9.21.0 shape.
    expect(text).toContain('[artifact: huge.parquet, 9000000 bytes, s3://bucket/huge.parquet]');
  });

  it("an adapter's own mediaType statement wins the extension table", async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ replies: [call('run_code', 't1', { code: 'x' }), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(
        codeRunnerTool({
          runner: runnerProducing([
            {
              name: 'data.bin',
              bytes: 3,
              data: new Uint8Array([1, 2, 3]),
              mediaType: 'application/x-custom',
            },
          ]),
        }),
      )
      .build();
    const events = artifactCapture(agent);
    await agent.run({ message: 'go' });
    const minted = events.find((e) => e.name === 'agentfootprint.artifacts.minted');
    expect(minted?.payload).toMatchObject({ kind: 'file/bin', mediaType: 'application/x-custom' });
  });
});

describe('integration — a code-produced file feeds a wants-tool', () => {
  it('run_code mints report.csv → transform tool wants file/csv → reads the exact bytes', async () => {
    const store = inMemoryArtifacts();
    let ref = '';
    const seen: { data?: unknown } = {};
    const { defineTool } = await import('../../src/index.js');
    const summarize = defineTool<{ file: string }, string>({
      name: 'summarize_csv',
      description: 'summarize a stored csv (pass the art_… ref)',
      inputSchema: {
        type: 'object',
        properties: { file: { type: 'string' } },
        required: ['file'],
      },
      wants: { file: 'file/csv' },
      execute: (args) => {
        seen.data = args.file;
        return `rows: ${(args.file as unknown as string).trim().split('\n').length - 1}`;
      },
    });
    const build = (replies: unknown[]) =>
      Agent.create({
        provider: mock({ replies: replies as never }),
        model: 'mock',
        maxIterations: 4,
        artifacts: store,
      })
        .system('s')
        .tool(
          codeRunnerTool({
            runner: runnerProducing([{ name: 'report.csv', bytes: CSV.length, data: CSV }]),
          }),
        )
        .tool(summarize)
        .build();

    const first = build([call('run_code', 't1', { code: 'x' }), final('made it')]);
    first.on('agentfootprint.artifacts.minted', (e) => {
      ref = (e.payload as { ref: string }).ref;
    });
    await first.run({ message: 'compute' }, { sessionId: 'pipeline' });
    expect(ref).toMatch(/^art_/);

    const second = build([call('summarize_csv', 't2', { file: ref }), final('done')]);
    const ends: Record<string, unknown>[] = [];
    second.on('agentfootprint.stream.tool_end', (e) =>
      ends.push(e.payload as Record<string, unknown>),
    );
    await second.run({ message: 'summarize' }, { sessionId: 'pipeline' });
    expect(seen.data).toBe(CSV);
    expect(String(ends[0].result)).toBe('rows: 2');
  });
});

describe('regression — zero-cost without a store, honest without data', () => {
  it('no store: the rendered artifact line is byte-identical to 9.21.0 and nothing fires', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [call('run_code', 't1', { code: 'x' }), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .tool(
        codeRunnerTool({
          runner: runnerProducing([{ name: 'report.csv', bytes: CSV.length, data: CSV }]),
        }),
      )
      .build();
    const events = artifactCapture(agent);
    const ends: Record<string, unknown>[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      ends.push(e.payload as Record<string, unknown>),
    );
    await agent.run({ message: 'go' });
    const text = String(ends[0].result);
    expect(text).toContain('[artifact: report.csv, 29 bytes]');
    expect(text).not.toContain('stored as');
    expect(events).toHaveLength(0);
  });
});
