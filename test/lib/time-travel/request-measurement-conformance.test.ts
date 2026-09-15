/**
 * Regression/integration: measure the initial prepared provider-port request,
 * not slot descriptions, HTTP envelopes, tokens, or later reliability retries.
 * Every size oracle below uses a request captured by the actual provider stub.
 */
import { Buffer } from 'node:buffer';
import { FlowChartExecutor } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  LLMCall,
  receiptAt,
  servedAt,
  type Receipt,
} from '../../../src/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { buildMessageApiChart } from '../../../src/core/agent/buildMessageApiChart.js';
import { gatedTools, staticTools } from '../../../src/tool-providers/index.js';

type Size = { jsonChars: number; jsonBytes: number };
type Measured = {
  status: 'measured';
  boundary: 'initial-prepared-request';
  format: 'json-utf8-v1';
  total: Size;
  slots: { systemPrompt?: Size; messages?: Size; tools?: Size };
};
type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;
type Reply = Pick<LLMResponse, 'content' | 'toolCalls'>;
const DONE: Reply = { content: 'done', toolCalls: [] };

function capture(reply: (request: LLMRequest, index: number) => Reply = () => DONE) {
  const requests: LLMRequest[] = [];
  const references: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'request-measurement-capture',
    carriesForcedToolChoice: true,
    complete: async (request) => {
      references.push(request);
      // The root signal is transport control, deliberately outside the metric.
      const { signal: _signal, ...content } = request;
      requests.push(JSON.parse(JSON.stringify(content)) as LLMRequest);
      return { ...reply(request, requests.length - 1), usage: { input: 3, output: 2 } };
    },
  };
  return { provider, requests, references };
}

function size(value: unknown): Size {
  const json = JSON.stringify(value);
  return { jsonChars: json.length, jsonBytes: Buffer.byteLength(json, 'utf8') };
}

function oracle(request: LLMRequest): Measured {
  const { signal: _signal, ...content } = request;
  return {
    status: 'measured',
    boundary: 'initial-prepared-request',
    format: 'json-utf8-v1',
    total: size(content),
    slots: {
      ...(request.systemPrompt !== undefined && { systemPrompt: size(request.systemPrompt) }),
      ...(request.messages !== undefined && { messages: size(request.messages) }),
      ...(request.tools !== undefined && { tools: size(request.tools) }),
    },
  };
}

function measured(snapshot: Snapshot, epoch: number): Measured | undefined {
  const receipt = receiptAt(snapshot, epoch);
  expect(receipt).toBeDefined();
  // This additive field is deliberately optional on recordings from older releases.
  return (receipt as Receipt & { requestMeasurement?: Measured }).requestMeasurement;
}

const tool = (name: string, schema: Readonly<Record<string, unknown>> = { type: 'object' }) =>
  defineTool({ name, description: 'x', inputSchema: schema, execute: () => 'ok' });

describe('initial prepared request measurement: real provider conformance', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: JSON UTF-8 counts include Unicode and escaped text without retaining it`, async () => {
      const { provider, requests } = capture();
      const system = 'PRIVATE_SYSTEM_日本語_🧪_e\u0301_"quoted"\\path\nnext';
      const message = 'PRIVATE_MESSAGE_Δ_😀_"\\\n';
      const agent = Agent.create({ provider, model: 'mock', reactMode }).system(system).build();
      await agent.run({ message });

      const measurement = measured(agent.getSnapshot()!, 1);
      expect(measurement).toEqual(oracle(requests[0]!));
      expect(measurement!.total.jsonBytes).toBeGreaterThan(measurement!.total.jsonChars);
      expect(measurement!.slots.systemPrompt!.jsonBytes).toBeGreaterThan(
        requests[0]!.systemPrompt!.length,
      );
      const recorded = JSON.stringify(measurement);
      for (const secret of ['PRIVATE_SYSTEM', 'PRIVATE_MESSAGE', '日本語', '🧪', 'quoted']) {
        expect(recorded).not.toContain(secret);
      }
      expect(measurement!.slots.tools).toBeUndefined();
      expect(requests).toHaveLength(1);
    });
  }

  it('counts a large full input schema even when its tool description is one character', async () => {
    const { provider, requests } = capture();
    const schema = {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: Array.from({ length: 700 }, (_, i) => `PRIVATE_ENUM_${i}_測定`),
        },
      },
    };
    const agent = Agent.create({ provider, model: 'mock' }).tool(tool('lookup', schema)).build();
    await agent.run({ message: 'lookup' });
    expect(requests[0]!.tools![0]!.description).toBe('x');
    const measurement = measured(agent.getSnapshot()!, 1);
    expect(measurement).toEqual(oracle(requests[0]!));
    expect(measurement!.slots.tools!.jsonBytes).toBeGreaterThan(18_000);
    expect(JSON.stringify(measurement)).not.toContain('PRIVATE_ENUM');
  });

  it('counts the winning schema once and excludes shadowed and gated-out candidates', async () => {
    const { provider, requests } = capture();
    const winner = tool('shared', { type: 'object', properties: { winner: { const: 1 } } });
    const shadow = tool('shared', { type: 'object', description: 'SHADOWED'.repeat(300) });
    const hidden = tool('hidden', { type: 'object', description: 'WITHHELD'.repeat(300) });
    const agent = Agent.create({ provider, model: 'mock' })
      .tool(winner)
      .toolProvider(gatedTools(staticTools([shadow, hidden]), (name) => name !== 'hidden'))
      .build();
    await agent.run({ message: 'go' });

    expect(requests[0]!.tools).toHaveLength(1);
    expect(requests[0]!.tools![0]!.inputSchema).toEqual(winner.schema.inputSchema);
    expect(measured(agent.getSnapshot()!, 1)).toEqual(oracle(requests[0]!));
    expect(JSON.stringify(requests[0]!.tools)).not.toMatch(/SHADOWED|WITHHELD/);
  });

  it('measures each iteration and the final wrap-up without previously offered tools', async () => {
    const { provider, requests } = capture((request, index) =>
      request.tools?.length
        ? { content: '', toolCalls: [{ id: `c${index}`, name: 'lookup', args: {} }] }
        : DONE,
    );
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 2 })
      .tool(tool('lookup'))
      .build();
    await agent.run({ message: 'go' });
    expect(requests.length).toBeGreaterThan(1);
    expect(requests[0]!.tools).toHaveLength(1);
    expect(requests.at(-1)!.tools).toBeUndefined();
    requests.forEach((request, index) => {
      expect(measured(agent.getSnapshot()!, index + 1)).toEqual(oracle(request));
    });
    expect(receiptAt(agent.getSnapshot()!, requests.length)!.tools.withheld).toBe('wrap-up');
  });

  it('measures cache-rewritten system, messages and schemas without changing the prepared request', async () => {
    const { provider, requests, references } = capture();
    const signal = new AbortController().signal;
    let prepared: LLMRequest | undefined;
    let preparedJson: string | undefined;
    const strategy = {
      name: 'measurement-rewrite',
      prepareRequest: async (request: LLMRequest) => {
        prepared = {
          ...request,
          systemPrompt: 'CACHE_SYSTEM_🧪',
          messages: [{ role: 'user', content: 'CACHE_MESSAGE_日本語' }],
          tools: [
            { name: 'rewritten', description: 'CACHE_SCHEMA', inputSchema: { enum: ['δ', '😀'] } },
          ],
          signal,
        };
        preparedJson = JSON.stringify(prepared);
        // Measurement must only read. Frozen top-level data catches accidental writes.
        Object.freeze(prepared);
        return { request: prepared, markersApplied: [] };
      },
      readCacheMetrics: () => ({ kind: 'notApplicable' as const, reason: 'fixture' }),
    };
    const agent = Agent.create({ provider, model: 'mock', cacheStrategy: strategy as never })
      .system('BEFORE_CACHE')
      .tool(tool('original'))
      .build();
    await agent.run({ message: 'before' });

    expect(references[0]).toBe(prepared);
    expect(references[0]!.signal).toBe(signal);
    expect(JSON.stringify(prepared)).toBe(preparedJson);
    const measurement = measured(agent.getSnapshot()!, 1);
    expect(measurement).toEqual(oracle(requests[0]!));
    expect(measurement!.total).not.toEqual(size(prepared));
    expect(measurement!.slots.systemPrompt).toEqual(size('CACHE_SYSTEM_🧪'));
    expect(JSON.stringify(measurement)).not.toMatch(/CACHE_SYSTEM|CACHE_MESSAGE|CACHE_SCHEMA/);
    expect(Object.keys(references[0]!)).not.toContain('requestMeasurement');
  });

  it('counts the synthetic forced-answer schema when that is the actual offered tool', async () => {
    const { provider, requests } = capture(() => ({
      content: '',
      toolCalls: [{ id: 'answer', name: 'respond_with_schema', args: { ok: true } }],
    }));
    const agent = Agent.create({ provider, model: 'mock' })
      .outputSchema({ safeParse: (value: unknown) => ({ success: true, data: value }) } as never, {
        strategy: 'tool-forced',
        jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      })
      .build();
    await agent.run({ message: 'go' });
    expect(requests[0]!.tools?.map((entry) => entry.name)).toEqual(['respond_with_schema']);
    expect(measured(agent.getSnapshot()!, 1)).toEqual(oracle(requests[0]!));
  });

  it('includes a staged-reference nudge present only in the current request', async () => {
    const { provider, requests } = capture((_request, index) =>
      index === 0
        ? { content: '', toolCalls: [{ id: 'export', name: 'export_rows', args: {} }] }
        : DONE,
    );
    const rows = JSON.stringify(Array.from({ length: 200 }, (_, id) => ({ id, gb: 18 })));
    const agent = Agent.create({
      provider,
      model: 'mock',
      artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2000 } },
    })
      .tool(defineTool({ name: 'export_rows', resultKind: 'dataset/rows', execute: () => rows }))
      .tool(
        defineTool({
          name: 'compute',
          inputSchema: { type: 'object', properties: { dataset: { type: 'string' } } },
          wants: { dataset: 'dataset/rows' },
          execute: () => 'ok',
        }),
      )
      .namesAndNumbersFromEvidence({ nudge: true })
      .build();
    await agent.run({ message: 'stage rows' });
    expect(requests).toHaveLength(2);
    expect(servedAt(agent.getSnapshot()!, 2)!.messages.requestOnly).toHaveLength(1);
    expect(measured(agent.getSnapshot()!, 2)).toEqual(oracle(requests[1]!));
  });

  it('records the attempted request even when the provider throws', async () => {
    const { provider, requests } = capture(() => {
      throw new Error('synthetic provider failure');
    });
    const agent = Agent.create({ provider, model: 'mock' }).system('attempted_🧪').build();
    await expect(agent.run({ message: 'go' })).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(measured(agent.getSnapshot()!, 1)).toEqual(oracle(requests[0]!));
  });

  it('uses the same measurement for an LLMCall chart', async () => {
    const { provider, requests } = capture();
    const call = LLMCall.create({ provider, model: 'mock' }).system('single_測定').build();
    await call.run({ message: 'go_🧪' });
    expect(measured(call.getSnapshot()! as unknown as Snapshot, 1)).toEqual(oracle(requests[0]!));
  });

  it('uses the same measurement for a message-API chart', async () => {
    const { provider, requests } = capture();
    const executor = new FlowChartExecutor(
      buildMessageApiChart({
        provider,
        model: 'mock',
        systemPrompt: 'message-api_測定',
        getRunId: () => 'measurement-message-api',
      }),
    );
    await executor.run({ input: { message: 'go_🧪' } });
    expect(measured(executor.getSnapshot() as unknown as Snapshot, 1)).toEqual(
      oracle(requests[0]!),
    );
  });

  it('keeps a historical receipt readable without inventing a measurement', async () => {
    const { provider } = capture();
    const agent = Agent.create({ provider, model: 'mock' }).build();
    await agent.run({ message: 'go' });
    const snapshot = JSON.parse(JSON.stringify(agent.getSnapshot())) as Snapshot;
    const log = snapshot as unknown as { commitLog: { overwrite: Record<string, unknown> }[] };
    for (const bundle of log.commitLog) {
      const receipt = bundle.overwrite.receipt as Record<string, unknown> | undefined;
      if (receipt) delete receipt.requestMeasurement;
    }
    expect(measured(snapshot, 1)).toBeUndefined();
    expect(servedAt(snapshot, 1)!.messages.asSent[0]!.content).toBe('go');
  });
});
