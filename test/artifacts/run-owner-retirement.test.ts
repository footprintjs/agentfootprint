import { expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  type ArtifactMeta,
  type AgentfootprintEvent,
} from '../../src/index.js';
import type { ArtifactStore } from '../../src/artifacts/types.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it.each([false, true])(
  'a delayed artifact keeps A ownership after retirement while B runs (time=%s)',
  async (withTime) => {
    const backing = inMemoryArtifacts();
    const upload = barrier(),
      bEntered = barrier(),
      bAnswer = barrier();
    const scopeA = { conversationId: 'late-artifact-A', principal: 'principal-A' };
    const scopeB = { conversationId: 'late-artifact-B', principal: 'principal-B' };
    const store: ArtifactStore = {
      ...backing,
      put: async (scope, input) => {
        if (input.kind === 'dataset/rows') await upload.promise;
        return backing.put(scope, input);
      },
    };
    let calls = 0;
    const provider: LLMProvider = {
      name: 'delayed-artifact-fixture',
      complete: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'upload-call', name: 'upload', args: {} }],
            usage: { input: 0, output: 0 },
          };
        }
        if (calls === 3) {
          bEntered.release();
          await bAnswer.promise;
        }
        return {
          content: calls === 2 ? 'A finished' : 'B finished',
          toolCalls: [],
          usage: { input: 0, output: 0 },
        };
      },
    };
    let pending: Promise<ArtifactMeta> | undefined;
    const builder = Agent.create({
      provider,
      model: 'fixture',
      artifacts: { store, recordings: true },
    }).tool(
      defineTool({
        name: 'upload',
        description: 'Local delayed artifact fixture.',
        execute: (_args, context) => {
          pending = context.artifacts.put({
            kind: 'dataset/rows',
            label: 'A-late-only',
            mediaType: 'application/json',
            data: [{ when: '2026-11-03T00:00:00Z' }],
            timeAxis: { column: 'when', unit: 'iso', zone: 'Europe/London' },
          });
          // Observe both outcomes immediately; assertions below own any rejection.
          void pending.then(
            () => undefined,
            () => undefined,
          );
          return 'upload pending';
        },
      }),
    );
    const agent = (withTime ? builder.time({ zone: 'UTC' }) : builder).build();
    const events: AgentfootprintEvent[] = [];
    agent.on('*', (event) => events.push(event));
    await expect(
      agent.run({ message: 'A', identity: scopeA }, { sessionId: 'session-A' }),
    ).resolves.toBe('A finished');
    expect(pending).toBeDefined();
    const rowA = (await backing.list(scopeA)).artifacts.find((row) => row.kind === 'recording/run');
    expect(rowA).toBeDefined();
    const recordA = await backing.get(scopeA, rowA!.ref);
    const runA = recordA!.meta.origin!.runId;
    const savedA = recordA!.data;
    const snapshotA = agent.getLastSnapshot();
    const snapshotAText = JSON.stringify(snapshotA);

    const runB = agent.run({ message: 'B', identity: scopeB }, { sessionId: 'session-B' });
    await bEntered.promise;
    try {
      upload.release();
      const settled = await pending!.then(
        (meta) => ({ ok: true as const, meta }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      expect
        .soft(settled.ok, 'the completed store write must not fail in a retired scope callback')
        .toBe(true);
      const minted = events.filter(
        (event) =>
          event.type === 'agentfootprint.artifacts.minted' &&
          (event.payload as { kind?: string }).kind === 'dataset/rows',
      );
      expect.soft(minted, 'one late fact retains its captured run owner').toHaveLength(1);
      expect.soft(minted[0]?.meta.runId).toBe(runA);
      expect.soft(minted[0]?.meta.sessionId).toBe('session-A');
      expect.soft(minted[0]?.meta.principal).toBe('principal-A');
      expect.soft(minted[0]?.meta.runtimeStageId).toBe('artifact-late#0');
      expect
        .soft(JSON.stringify(snapshotA), 'a completed snapshot stays fixed')
        .toBe(snapshotAText);
    } finally {
      bAnswer.release();
      await expect(runB).resolves.toBe('B finished');
    }

    const lateRows = (await backing.list(scopeA)).artifacts.filter(
      (row) => row.kind === 'dataset/rows',
    );
    expect(lateRows).toHaveLength(1);
    expect(lateRows[0]!.origin?.runId).toBe(runA);
    expect((await backing.get(scopeA, rowA!.ref))!.data).toEqual(savedA);
    const rowB = (await backing.list(scopeB)).artifacts.find((row) => row.kind === 'recording/run');
    const recordB = await backing.get(scopeB, rowB!.ref);
    expect(recordB!.meta.origin!.runId).not.toBe(runA);
    const savedB = JSON.parse(recordB!.data as string) as { events: AgentfootprintEvent[] };
    expect(
      savedB.events.some(
        (event) =>
          event.type === 'agentfootprint.artifacts.minted' &&
          (event.payload as { ref?: string }).ref === lateRows[0]!.ref,
      ),
    ).toBe(false);
    expect((agent.findings() ?? []).filter((row) => row.kind === 'source-clock')).toEqual([]);
    expect(JSON.stringify(savedB)).not.toContain('A-late-only');
    expect(calls).toBe(3);
  },
);
