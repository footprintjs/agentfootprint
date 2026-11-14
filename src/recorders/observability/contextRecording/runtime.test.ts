import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../core/Agent.js';
import { LLMCall } from '../../../core/LLMCall.js';
import { Parallel } from '../../../core-flow/Parallel.js';
import { defineTool } from '../../../tools/tools.js';
import { MockProvider } from '../../../adapters/llm/MockProvider.js';
import type { LLMRequest } from '../../../provider-contract/types.js';
import type { Runner } from '../../../core/runner.js';
import { recordContextRun } from '../contextRecording.js';
import type { Recording } from '../recordRun.js';
import { readContextRecording } from './read.js';
import type { ContextValueWriter } from './types.js';

function port() {
  const contents: unknown[] = [];
  const writer: ContextValueWriter = {
    async intern(_label, value) {
      const ref = String(contents.length);
      contents.push(structuredClone(value));
      return { status: 'stored', reference: { ref } };
    },
    record: (record) => ({ format: 'foottrace.value-record.v1', record, valueTable: contents }),
  };
  const open = async (input: unknown) => ({
    record: (input as { record: unknown }).record,
    values: { resolve: (r: unknown) => contents[Number((r as { ref: string }).ref)] },
  });
  return { writer, open, contents };
}

function makeAgent(requests: LLMRequest[], deferred = false, redact = false) {
  let calls = 0;
  const provider = new MockProvider({
    respond(request) {
      // The provider receives scope-backed arrays; compare what its JSON wire
      // serializes, rather than demanding a structuredClone of a live Proxy.
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      return ++calls < 3
        ? { toolCalls: [{ id: `call-${calls}`, name: 'lookup', args: { id: 'one' } }] }
        : 'done';
    },
  });
  return Agent.create({
    provider,
    model: 'mock',
    observerDelivery: deferred ? 'deferred' : 'inline',
    ...(redact ? { redact: { keys: ['rawContent', 'inputSchema'] } } : {}),
  })
    .system('A stable standing rule. '.repeat(100))
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Look up one item.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        execute: () => 'found',
      }),
    )
    .maxIterations(4)
    .build();
}

describe('native context recorder', () => {
  it('closes every sensitive capture even when a member cleanup throws', () => {
    const runner = makeAgent([]);
    const values = port();
    const failure = new Error('cleanup failed');
    let lastClosed = 0;
    const bad = {
      on: () => () => {
        throw failure;
      },
    } as unknown as Runner;
    const last = {
      on: () => () => {
        lastClosed++;
      },
    } as unknown as Runner;
    const recorder = recordContextRun(runner, values.writer, { members: [bad, last] });
    expect(() => recorder.stop()).toThrow(failure);
    expect(lastClosed).toBe(1);
    expect(runner.listenerCount('agentfootprint.context.recorded')).toBe(0);
    expect(() => recorder.stop()).not.toThrow();
    expect(lastClosed).toBe(1);
  });

  it('releases acquired capture grants if setup fails, preserving the setup failure', () => {
    const runner = makeAgent([]);
    const values = port();
    const failure = new Error('setup failed');
    let closed = 0;
    const first = {
      on: () => () => {
        closed++;
        throw new Error('secondary cleanup');
      },
    } as unknown as Runner;
    const bad = {
      on: () => {
        throw failure;
      },
    } as unknown as Runner;
    expect(() => recordContextRun(runner, values.writer, { members: [first, bad] })).toThrow(
      failure,
    );
    expect(closed).toBe(1);
    expect(runner.listenerCount('agentfootprint.context.recorded')).toBe(0);
  });
  it.each([false, true])(
    'leaves actual provider requests unchanged (deferred=%s)',
    async (deferred) => {
      const ordinary: LLMRequest[] = [];
      const captured: LLMRequest[] = [];
      await makeAgent(ordinary, deferred).run({ message: 'hello' });
      const runner = makeAgent(captured, deferred);
      const values = port();
      const recorder = recordContextRun(runner, values.writer);
      await runner.run({ message: 'hello' });
      recorder.stop();
      const saved = await recorder.toRecording();
      expect(captured).toEqual(ordinary);
      expect(saved.record.calls).toHaveLength(3);
      expect(
        saved.record.calls.map((c) => [c.added.length, c.removed.length, c.unchanged]),
      ).toEqual([
        [2, 0, 0],
        [0, 0, 2],
        [0, 0, 2],
      ]);
      expect(saved.record.calls.every((c) => c.counts.tools === 1)).toBe(true);
      const read = await readContextRecording(saved, values.open);
      expect(
        (read.recording as Recording).events.some(
          (e) => e.type === 'agentfootprint.context.recorded',
        ),
      ).toBe(false);
      const before = recorder.eventCount;
      await runner.run({ message: 'later' });
      expect(recorder.eventCount).toBe(before);
    },
  );

  it('captures mounted parallel members under their actual native owners', async () => {
    const one = LLMCall.create({
      provider: new MockProvider({ reply: 'one' }),
      model: 'mock',
      name: 'first',
    })
      .system('first rule')
      .build();
    const two = LLMCall.create({
      provider: new MockProvider({ reply: 'two' }),
      model: 'mock',
      name: 'second',
    })
      .system('second rule')
      .build();
    const runner = Parallel.create()
      .branch('one', one)
      .branch('two', two)
      .mergeWithFn((r) => Object.values(r).join(' | '))
      .build();
    const values = port();
    const ui = vi.spyOn(runner, 'getUIGroupWith').mockImplementation(() => {
      throw new Error('UI must not run during recording');
    });
    const recorder = recordContextRun(runner, values.writer, { members: [one, two] });
    await runner.run({ message: 'hello' });
    recorder.stop();
    const saved = await recorder.toRecording();
    expect(ui).not.toHaveBeenCalled();
    expect(saved.record.calls).toHaveLength(2);
    expect(
      new Set(saved.record.calls.map((c) => JSON.stringify([c.meta.runId, c.meta.subflowPath])))
        .size,
    ).toBe(2);
    expect(
      saved.record.calls.every((c) => c.call === 1 && c.added.length === 1 && c.unchanged === 0),
    ).toBe(true);
  });

  it('captures every model call despite a saturated deferred observer queue', async () => {
    const runner = Agent.create({
      provider: new MockProvider({ reply: 'done' }),
      model: 'mock',
      observerDelivery: 'deferred',
      observerDeliveryOptions: { maxQueue: 1, overflow: 'drop-oldest' },
    })
      .system('rule')
      .build();
    const values = port();
    const recorder = recordContextRun(runner, values.writer);
    await runner.run({ message: 'hello' });
    recorder.stop();
    expect((await recorder.toRecording()).record.calls).toHaveLength(1);
  });

  it('owns a selected schema before the provider can mutate the original', async () => {
    const schema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
    const runner = Agent.create({
      provider: new MockProvider({
        respond() {
          schema.required.push('later');
          return 'done';
        },
      }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'lookup',
          description: 'Look up',
          inputSchema: schema,
          execute: () => 'ok',
        }),
      )
      .build();
    const values = port();
    const recorder = recordContextRun(runner, values.writer);
    await runner.run({ message: 'hello' });
    recorder.stop();
    await recorder.toRecording();
    expect(values.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inputSchema: expect.objectContaining({ required: ['id'] }) }),
      ]),
    );
    expect(schema.required).toEqual(['id', 'later']);
  });

  it('keeps native redaction in force through the table and expansion', async () => {
    const runner = makeAgent([], false, true);
    const values = port();
    const recorder = recordContextRun(runner, values.writer);
    await runner.run({ message: 'hello' });
    recorder.stop();
    const saved = await recorder.toRecording();
    expect(JSON.stringify(values.contents)).not.toContain('A stable standing rule.');
    expect(JSON.stringify(values.contents)).not.toContain('required');
    const read = await readContextRecording(saved, values.open);
    const text = JSON.stringify((read.recording as Recording).events);
    expect(text).not.toContain('A stable standing rule.');
    expect(text).not.toContain('required');
  });
});
