/**
 * Property tests — the inputs layer's laws over GENERATED property schemas and
 * values (a seeded generator: the repo carries no property-testing library, and
 * a fixed seed keeps every case reproducible by its index).
 *
 * The laws:
 *   1. a value the property's own schema accepts is accepted at definition as
 *      an `assume`, and the call the library fills passes `validateToolArgs`
 *      against the AUTHOR's schema — `required` included;
 *   2. the served decoration is a pure function of (schema, rule): the same
 *      inputs give the same bytes, a structured clone of the schema gives an
 *      equal result, and the registry schema is never edited;
 *   3. the replay (`servedAt`) rebuilds the committed list byte for byte — what
 *      the provider was handed is what the record says it was handed;
 *   4. for every call, missing ⇒ filled `default`, equal ⇒ `default` with
 *      `proposed`, anything else ⇒ `model` — and exactly one row per ruled
 *      argument of every dispatched call.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, servedAt, epochLocations, type Tool } from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import { validateToolArgs } from '../../../../src/core/agent/toolArgsValidation.js';
import { withArgumentRules } from '../../../../src/core/agent/arguments/serve.js';
import type { ArgumentRow } from '../../../../src/core/agent/arguments/rows.js';

/** mulberry32 — a tiny seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Case = {
  readonly property: Record<string, unknown>;
  readonly assumed: string | number | boolean;
  readonly other: string | number | boolean;
};

const WORDS = ['1h', '2h', '24h', '7d', '30m', 'fast', 'slow', 'EU-west'];

function caseOf(seed: number): Case {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  switch (pick(['enum', 'string', 'integer', 'number', 'boolean'] as const)) {
    case 'enum': {
      const values = WORDS.filter(() => r() < 0.6);
      const enumValues = values.length >= 2 ? values : ['a', 'b'];
      const assumed = pick(enumValues);
      const other = enumValues.find((v) => v !== assumed)!;
      return { property: { type: 'string', enum: enumValues }, assumed, other };
    }
    case 'string': {
      const assumed = pick(WORDS);
      return {
        property: { type: 'string', description: 'free text' },
        assumed,
        other: `${assumed}-other`,
      };
    }
    case 'integer': {
      const assumed = Math.floor(r() * 500);
      return { property: { type: 'integer' }, assumed, other: assumed + 1 };
    }
    case 'number': {
      const assumed = Math.round(r() * 10_000) / 100;
      return { property: { type: 'number' }, assumed, other: assumed + 0.5 };
    }
    case 'boolean': {
      const assumed = r() < 0.5;
      return { property: { type: 'boolean' }, assumed, other: !assumed };
    }
  }
}

const CASES = Array.from({ length: 60 }, (_, i) => [i, caseOf(20260927 + i)] as const);

function toolFor(c: Case): Tool {
  return defineTool({
    name: 'probe',
    description: 'a probe',
    inputSchema: {
      type: 'object',
      required: ['id', 'arg'],
      properties: { id: { type: 'string' }, arg: c.property },
    },
    askOrAssume: { arg: { assume: c.assumed } },
    execute: () => 'ok',
  }) as Tool;
}

describe('property — the assume value is judged by the property, and the fill is valid', () => {
  it.each(CASES)('case %i', (_i, c) => {
    const tool = toolFor(c);
    const filled = { id: 'x', arg: c.assumed };
    expect(validateToolArgs(filled, tool.schema.inputSchema).ok).toBe(true);
    // …and the call WITHOUT the argument is exactly what the fill completes.
    expect(validateToolArgs({ id: 'x' }, tool.schema.inputSchema).ok).toBe(false);
  });
});

describe('property — the decoration is a pure function of (schema, rule)', () => {
  it.each(CASES)('case %i', (_i, c) => {
    const tool = toolFor(c);
    const before = JSON.stringify(tool.schema);
    const a = withArgumentRules(tool.schema, tool);
    const b = withArgumentRules(structuredClone(tool.schema), tool);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.inputSchema.required).toEqual(['id']);
    expect(JSON.stringify(tool.schema)).toBe(before);
  });
});

function scripted(script: readonly { content: string; toolCalls?: unknown[] }[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'property-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        const reply = script[Math.min(i, script.length - 1)]!;
        i += 1;
        return {
          content: reply.content,
          toolCalls: (reply.toolCalls ?? []) as never,
          usage: { input: 0, output: 0 },
        };
      },
    },
  };
}

describe('property — the run: one row per ruled argument, the table, and a byte-equal replay', () => {
  it.each(CASES.filter(([i]) => i % 3 === 0))('case %i', async (i, c) => {
    const r = prng(9000 + i);
    const shapes = [{}, { arg: c.assumed }, { arg: c.other }] as const;
    const calls = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, k) => ({
      id: `c${k}`,
      name: 'probe',
      args: { id: `x${k}`, ...shapes[Math.floor(r() * 3)] },
    }));
    const m = scripted([{ content: '', toolCalls: calls }, { content: 'done' }]);
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(toolFor(c))
      .build();
    await agent.run({ message: 'go' });

    const rows = (agent.findings() ?? []).filter(
      (row): row is ArgumentRow => row.kind === 'argument',
    );
    expect(rows.map((row) => row.toolCallId)).toEqual(calls.map((call) => call.id));
    for (const [k, call] of calls.entries()) {
      const row = rows[k]!;
      if (!('arg' in call.args)) {
        expect(row).toMatchObject({ source: 'default', value: String(c.assumed) });
        expect(row).not.toHaveProperty('proposed');
      } else if (call.args.arg === c.assumed) {
        expect(row).toMatchObject({ source: 'default', proposed: String(c.assumed) });
      } else {
        expect(row.source).toBe('model');
      }
    }

    // The replay rebuilds exactly what the provider was handed.
    const snapshot = agent.getSnapshot()!;
    const epochs = epochLocations(snapshot).map((l) => l.epoch);
    expect(epochs.length).toBe(m.requests.length);
    for (const [k, epoch] of epochs.entries()) {
      const view = servedAt(snapshot, epoch)!;
      expect(JSON.stringify(view.tools.schemas)).toBe(JSON.stringify(m.requests[k]!.tools ?? []));
    }
  });
});
