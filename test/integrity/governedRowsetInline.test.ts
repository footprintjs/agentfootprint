import type { AgentfootprintEvent } from '../../src/events.js';
import { describe, expect, it } from 'vitest';
import { Agent, defineTool, type ToolResultColumns } from '../../src/index.js';
import { mock } from '../../src/providers.js';
import { inlineRowset, RowsetUnavailable } from '../../src/core/agent/resultRowsets/inlineRows.js';

async function inspect(
  value: unknown,
  columns: ToolResultColumns,
  mode: 'warn' | 'enforce' = 'warn',
) {
  const events: AgentfootprintEvent[] = [];
  let calls = 0;
  let served = '';
  const tool = defineTool({
    name: 'inline_contract',
    description: 'Synthetic typed rows.',
    resultRowsets: [{ key: 'root', columns, source: { kind: 'inline', path: [] } }],
    execute: async () => {
      calls++;
      return value;
    },
  });
  const agent = Agent.create({
    model: 'mock',
    checkColumnTypes: mode,
    integrityPosture: 'dev',
    maxIterations: 3,
    provider: mock({
      respond(request) {
        const last = request.messages.at(-1);
        if (last?.role === 'tool') {
          served = last.content;
          return 'Observed.';
        }
        return { toolCalls: [{ id: 'inline-call', name: 'inline_contract', args: {} }] };
      },
    }),
  })
    .tool(tool)
    .build();
  agent.on('*', (event) => events.push(event));
  {
    await agent.run({ message: 'Read synthetic rows.' });
    return {
      calls,
      served,
      findings: events
        .filter((event) => event.type === 'agentfootprint.integrity.context_error')
        .map((event) => event.payload),
      checks: events
        .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
        .map((event) => event.payload),
    };
  }
}

describe('the final inline binding preserves native column semantics', () => {
  it('accepts a genuine Date and preserves the distinction from a string column', async () => {
    const value = [{ measured: new Date('2026-01-02T03:04:05Z') }];
    const valid = await inspect(value, { measured: 'date' });
    expect(valid.calls).toBe(1);
    expect(valid.findings).toEqual([]);
    expect(valid.checks).toMatchObject([
      { rowset: 'root', disposition: 'checked-pass', reason: 'rows' },
    ]);
    const wrong = await inspect(value, { measured: 'string' }, 'enforce');
    expect(wrong.calls).toBe(1);
    expect(wrong.findings).toMatchObject([
      { kind: 'column-type-mismatch', rowset: 'root', predicate: 'measured' },
    ]);
    expect(wrong.served).toMatch(/^Result rejected:/);
  });

  it.each([NaN, Infinity, -Infinity])(
    'judges %s as a real number mismatch, never unavailable',
    async (value) => {
      const result = await inspect([{ amount: value }], { amount: 'number' });
      expect(result.findings).toMatchObject([{ kind: 'column-type-mismatch', rowset: 'root' }]);
      expect(result.checks).toMatchObject([{ reason: 'rows', disposition: 'checked-fail' }]);
    },
  );

  it('keeps own undefined distinct from a missing column and honors nullable', async () => {
    const valid = await inspect([{ amount: undefined }], {
      amount: { type: 'number', nullable: true },
    });
    expect(valid.findings).toEqual([]);
    expect(valid.checks).toMatchObject([{ disposition: 'checked-pass' }]);
    const wrong = await inspect([{}], { amount: { type: 'number', nullable: true } });
    expect(wrong.findings).toMatchObject([{ kind: 'missing-column' }]);
  });

  it('judges exactly1000 rows, and refuses1001 without a fake type finding', async () => {
    const allowed = await inspect(
      Array.from({ length: 1000 }, () => ({ amount: 0 })),
      { amount: 'number' },
    );
    expect(allowed.checks).toMatchObject([{ disposition: 'checked-pass' }]);
    const over = await inspect(
      Array.from({ length: 1001 }, () => ({ amount: 0 })),
      { amount: 'number' },
      'enforce',
    );
    expect(over.findings).toEqual([]);
    expect(over.checks).toMatchObject([
      { disposition: 'unavailable', reason: 'source-over-bound', delivery: 'refused' },
    ]);
    expect(over.served).toMatch(/^Result rejected:/);
  });
});

describe('the bounded native snapshot never executes data', () => {
  it('uses exact serialized UTF8 bytes at the boundary for ordinary JSON rows', () => {
    const rows = [{ text: 'é\\"' }];
    const bytes = new TextEncoder().encode(JSON.stringify(rows)).length;
    expect(inlineRowset(rows, 1000, bytes).rows).toEqual(rows);
    expect(() => inlineRowset(rows, 1000, bytes - 1)).toThrow('source-over-bound');
  });

  it('rejects cell and array accessors without invoking either', () => {
    let getters = 0;
    const row = Object.defineProperty({}, 'amount', {
      enumerable: true,
      get: () => {
        getters++;
        return 0;
      },
    });
    const array = Object.defineProperty([{}], '0', {
      enumerable: true,
      get: () => {
        getters++;
        return {};
      },
    });
    expect(() => inlineRowset([row])).toThrow('unsupported-shape');
    expect(() => inlineRowset(array)).toThrow('unsupported-shape');
    expect(getters).toBe(0);
  });

  it('rejects custom prototypes, Date impostors, toJSON and executable cells without running them', () => {
    let executions = 0;
    const hook = {
      toJSON() {
        executions++;
        return 'hidden';
      },
    };
    for (const value of [
      Object.create({ amount: 0 }),
      { amount: Object.create(Date.prototype) },
      { amount: hook },
      { amount: () => executions++ },
    ])
      expect(() => inlineRowset([value])).toThrow(RowsetUnavailable);
    expect(executions).toBe(0);
  });

  it('does not call an instance Date method or getter', () => {
    let calls = 0;
    const date = new Date(0);
    Object.defineProperty(date, 'getTime', {
      get: () => {
        calls++;
        return () => 0;
      },
    });
    expect(() => inlineRowset([{ measured: date }])).toThrow('unsupported-shape');
    expect(calls).toBe(0);
  });

  it('bounds nesting, cycles and sparse arrays', () => {
    const deep = (levels: number): unknown => {
      let value: unknown = 0;
      for (let index = 0; index < levels; index++) value = { child: value };
      return [{ amount: value }];
    };
    expect(() => inlineRowset(deep(14))).not.toThrow();
    expect(() => inlineRowset(deep(15))).toThrow('source-over-bound');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => inlineRowset([cycle])).toThrow('unsupported-shape');
    expect(() => inlineRowset(new Array(1))).toThrow('unsupported-shape');
  });
});
