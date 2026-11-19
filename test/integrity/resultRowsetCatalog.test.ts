/** Actual native catalog/dispatch controls; no model service or replacement executor. */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  isPaused,
  type Tool,
  type AwaitingInput,
  type ToolResultRowset,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';
import { defineSkill } from '../../src/doors/context.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import {
  resultRowsetCatalog,
  resultRowsetsReader,
  holdProviderRowsets,
  clearProviderRowsets,
} from '../../src/core/agent/resultRowsets/catalog.js';
import { buildToolResolver } from '../../src/core/agent/stages/toolResolver.js';

const rowset = (key: string): readonly ToolResultRowset[] => [
  {
    key,
    columns: { value: 'number' },
    source: { kind: 'inline', path: [key] },
  },
];
class SharedTool implements Tool {
  readonly schema = {
    name: 'read_catalog_rows',
    description: 'Read synthetic rows.',
    inputSchema: { type: 'object', properties: { step: { type: 'number' } } },
  };
  resultRowsets = rowset('first');
  #calls = 0;
  get calls() {
    return this.#calls;
  }
  execute() {
    this.#calls++;
    return { first: [{ value: 'wrong-first' }], second: [{ value: 'wrong-second' }] };
  }
}
const call = (step = 1) => ({
  id: 'reused-native-call',
  name: 'read_catalog_rows',
  args: { step },
});
const payload = (event: AgentfootprintEvent) => event.payload as unknown as Record<string, unknown>;
const watch = (agent: ReturnType<ReturnType<typeof Agent.create>['build']>) => {
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (event) => events.push(event));
  return events;
};
const columnFindings = (events: readonly AgentfootprintEvent[]) =>
  events
    .filter((event) => event.type === 'agentfootprint.integrity.context_error')
    .map(payload)
    .filter((row) => row.kind === 'column-type-mismatch');
function writeRows(events: readonly AgentfootprintEvent[]) {
  const fact = [...events]
    .reverse()
    .find((event) => event.type === 'agentfootprint.integrity.disposition');
  expect(fact).toBeDefined();
  return (payload(fact!).rows as Record<string, unknown>[]).filter(
    (row) =>
      row.seam === 'write' &&
      ['column-type-mismatch', 'missing-column'].includes(String(row.check)),
  );
}
function ready() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const model = () => mock({ replies: [{ toolCalls: [call()] }, 'Done.'] });

describe('component-owned new rowset metadata at native catalog intake', () => {
  it('private membership unit: the actual paused party selects its own snapshot for a shared Tool', () => {
    const tool = new SharedTool(),
      name = tool.schema.name;
    const registered = resultRowsetCatalog([[name, tool]]);
    tool.resultRowsets = rowset('second');
    const cache = { current: [tool] };
    holdProviderRowsets(cache, resultRowsetCatalog([[name, tool]]));
    const resolve = buildToolResolver({
      registryByName: new Map([[name, tool]]),
      externalToolProvider: { id: 'catalog-provider', list: () => [tool] },
      providerToolCache: cache,
      servedTools: {
        current: new Map([[name, { channel: 'provider' as const, id: 'catalog-provider' }]]),
        lastServed: new Map(),
      },
      toolClaimants: new Map([[name, [{ channel: 'registry' as const, tool }]]]),
      notServed: () => 'The saved party no longer answered that call.',
    });
    const read = resultRowsetsReader(registered, cache, resolve);
    try {
      expect(read(name, tool)?.[0]?.key).toBe('second');
      expect(read(name, tool, { channel: 'registry' })?.[0]?.key).toBe('first');
      expect(read(name, tool, { channel: 'provider', id: 'foreign-provider' })).toBeUndefined();
      clearProviderRowsets(cache);
      expect(read(name, tool)).toBeUndefined(); // No old list or static fallback.
      expect(read(name, tool, { channel: 'registry' })?.[0]?.key).toBe('first');
    } finally {
      clearProviderRowsets(cache);
    }
  });

  it('holds raw static declarations before later mutation without cloning class-backed tools', async () => {
    const tool = new SharedTool();
    const agent = Agent.create({
      answerLayer: false,
      provider: model(),
      model: 'mock',
      checkColumnTypes: 'warn',
      integrityPosture: 'dev',
    })
      .tool(tool)
      .build();
    const events = watch(agent);
    let getterReads = 0;
    Object.defineProperty(tool, 'resultRowsets', {
      enumerable: true,
      get() {
        getterReads++;
        throw new Error('A later raw declaration must never replace the held one.');
      },
    });
    try {
      expect(await agent.run({ message: 'Read synthetic rows.' })).toBe('Done.');
      expect(tool.calls).toBe(1); // #calls requires the exact original this/private brand.
      expect(getterReads).toBe(0);
      expect(columnFindings(events).map((row) => row.rowset)).toEqual(['first']);
    } finally {
      await agent.shutdown();
    }
  });

  it('separates two Agents sharing one Tool object and two differently acquired declarations', async () => {
    const tool = new SharedTool();
    const first = Agent.create({ provider: model(), model: 'mock', checkColumnTypes: 'warn' })
      .tool(tool)
      .build();
    tool.resultRowsets = rowset('second');
    const second = Agent.create({ provider: model(), model: 'mock', checkColumnTypes: 'warn' })
      .tool(tool)
      .build();
    const firstEvents = watch(first),
      secondEvents = watch(second);
    try {
      await Promise.all([
        first.run({ message: 'Read first synthetic rows.' }),
        second.run({ message: 'Read second synthetic rows.' }),
      ]);
      expect(tool.calls).toBe(2);
      expect(columnFindings(firstEvents).map((row) => row.rowset)).toEqual(['first']);
      expect(columnFindings(secondEvents).map((row) => row.rowset)).toEqual(['second']);
    } finally {
      await Promise.all([first.shutdown(), second.shutdown()]);
    }
  });

  it('isolates concurrent provider acquisitions of the same Tool without a global Tool-keyed cache', async () => {
    const tool = new SharedTool(),
      firstReady = ready(),
      secondReady = ready();
    let firstRequests = 0,
      secondRequests = 0;
    const first = Agent.create({
      model: 'mock',
      checkColumnTypes: 'warn',
      provider: {
        name: 'synthetic-first-catalog-model',
        async complete() {
          if (++firstRequests > 1)
            return {
              content: 'Done.',
              toolCalls: [],
              stopReason: 'end_turn' as const,
              usage: { input: 0, output: 0 },
            };
          firstReady.release();
          await secondReady.promise;
          return {
            content: '',
            toolCalls: [call()],
            stopReason: 'tool_use' as const,
            usage: { input: 0, output: 0 },
          };
        },
      },
    })
      .toolProvider({
        id: 'first-provider',
        list() {
          tool.resultRowsets = rowset('first');
          return [tool];
        },
      })
      .build();
    const second = Agent.create({
      model: 'mock',
      checkColumnTypes: 'warn',
      provider: mock({
        respond() {
          if (++secondRequests > 1) return 'Done.';
          secondReady.release();
          return { toolCalls: [call()] };
        },
      }),
    })
      .toolProvider({
        id: 'second-provider',
        list() {
          tool.resultRowsets = rowset('second');
          return [tool];
        },
      })
      .build();
    const firstEvents = watch(first),
      secondEvents = watch(second);
    try {
      const one = first.run({ message: 'Read first synthetic rows.' });
      // Readiness comes from the actual model callback after native discovery.
      await Promise.race([
        firstReady.promise,
        one.then(() => {
          throw new Error('Run ended before readiness.');
        }),
      ]);
      await Promise.all([one, second.run({ message: 'Read second synthetic rows.' })]);
      expect(tool.calls).toBe(2);
      expect(columnFindings(firstEvents).map((row) => row.rowset)).toEqual(['first']);
      expect(columnFindings(secondEvents).map((row) => row.rowset)).toEqual(['second']);
    } finally {
      firstReady.release();
      secondReady.release();
      await Promise.all([first.shutdown(), second.shutdown()]);
    }
  });

  it('uses the offered party snapshot even when a skill and provider share the exact same Tool object', async () => {
    const tool = new SharedTool();
    const skill = defineSkill({
      id: 'catalog-fixture',
      description: 'Synthetic rows.',
      body: 'Read synthetic rows.',
      tools: [tool],
    });
    const agent = Agent.create({
      answerLayer: false,
      provider: model(),
      model: 'mock',
      checkColumnTypes: 'warn',
    })
      .skills({ list: () => [skill] })
      .toolsFromActiveSkill()
      .toolProvider({
        list() {
          tool.resultRowsets = rowset('second');
          return [tool];
        },
      })
      .build();
    const events = watch(agent);
    try {
      expect(await agent.run({ message: 'Read synthetic rows.' })).toBe('Done.');
      expect(tool.calls).toBe(1);
      expect(columnFindings(events).map((row) => row.rowset)).toEqual(['second']);
    } finally {
      await agent.shutdown();
    }
  });

  it('replaces provider metadata at each actual list while preserving already filed findings', async () => {
    const tool = new SharedTool();
    let lists = 0;
    const agent = Agent.create({
      answerLayer: false,
      provider: mock({ replies: [{ toolCalls: [call(1)] }, { toolCalls: [call(2)] }, 'Done.'] }),
      model: 'mock',
      checkColumnTypes: 'warn',
      integrityPosture: 'dev',
      maxIterations: 4,
    })
      .toolProvider({
        list() {
          tool.resultRowsets = rowset(++lists === 1 ? 'first' : 'second');
          return [tool];
        },
      })
      .build();
    const events = watch(agent);
    try {
      expect(await agent.run({ message: 'Read both synthetic sets.' })).toBe('Done.');
      expect(lists).toBe(3);
      expect(tool.calls).toBe(2);
      expect(columnFindings(events).map((row) => row.rowset)).toEqual(['first', 'second']);
    } finally {
      await agent.shutdown();
    }
  });

  it('a withdrawn provider tool cannot reuse the prior acquisition declaration or execute again', async () => {
    const tool = new SharedTool();
    let lists = 0;
    const agent = Agent.create({
      answerLayer: false,
      model: 'mock',
      checkColumnTypes: 'warn',
      integrityPosture: 'dev',
      maxIterations: 4,
      provider: mock({ replies: [{ toolCalls: [call(1)] }, { toolCalls: [call(2)] }, 'Done.'] }),
    })
      .toolProvider({ list: () => (++lists === 1 ? [tool] : []) })
      .build();
    const events = watch(agent);
    try {
      expect(await agent.run({ message: 'Read synthetic rows.' })).toBe('Done.');
      expect(tool.calls).toBe(1);
      expect(columnFindings(events).map((row) => row.rowset)).toEqual(['first']);
      expect(
        events.filter((event) => event.type === 'agentfootprint.tools.rowset_checked'),
      ).toHaveLength(1);
    } finally {
      await agent.shutdown();
    }
  });

  it('refuses accessor metadata at actual provider acquisition without invoking its getter', async () => {
    const tool = new SharedTool();
    let getterReads = 0,
      requests = 0;
    Object.defineProperty(tool, 'resultRowsets', {
      enumerable: true,
      get() {
        getterReads++;
        return rowset('first');
      },
    });
    const agent = Agent.create({
      model: 'mock',
      checkColumnTypes: 'warn',
      provider: mock({
        respond() {
          requests++;
          return 'Should not run.';
        },
      }),
    })
      .toolProvider({ list: () => [tool] })
      .build();
    try {
      await expect(agent.run({ message: 'Read synthetic rows.' })).rejects.toThrow(/resultRowsets/);
      expect(getterReads).toBe(0);
      expect(requests).toBe(0);
      expect(tool.calls).toBe(0);
    } finally {
      await agent.shutdown();
    }
  });

  it.each(['off', 'warn'] as const)(
    'states honest no-declaration accounting across responses (%s)',
    async (mode) => {
      let calls = 0;
      const tool = defineTool({
        name: 'read_plain',
        description: 'Read a synthetic value.',
        inputSchema: { type: 'object', properties: { step: { type: 'number' } } },
        execute: () => {
          calls++;
          return 'plain';
        },
      });
      const agent = Agent.create({
        model: 'mock',
        checkColumnTypes: mode,
        integrityPosture: 'dev',
        maxIterations: 4,
        provider: mock({
          replies: [
            ...[1, 2].map((step) => ({
              toolCalls: [{ id: `plain-${step}`, name: 'read_plain', args: { step } }],
            })),
            'Done.',
          ],
        }),
      })
        .toolProvider({ list: () => [tool] })
        .build();
      const events = watch(agent);
      try {
        expect(await agent.run({ message: 'Read twice.' })).toBe('Done.');
        expect(calls).toBe(2);
        expect(writeRows(events)).toHaveLength(2);
        for (const row of writeRows(events))
          expect(row).toMatchObject({
            checked: 0,
            findings: 0,
            unreachable: 0,
            notApplicable: mode === 'off' ? 1 : 3,
          });
        expect(events.some((event) => event.type === 'agentfootprint.tools.rowset_checked')).toBe(
          false,
        );
      } finally {
        await agent.shutdown();
      }
    },
  );

  it('discovery failure before the first model call remains no-work, with no manufactured write disposition', async () => {
    let requests = 0;
    const agent = Agent.create({
      model: 'mock',
      checkColumnTypes: 'warn',
      integrityPosture: 'dev',
      provider: mock({
        respond() {
          requests++;
          return 'Should not run.';
        },
      }),
    })
      .toolProvider({
        list() {
          throw new Error('Deliberate synthetic discovery failure.');
        },
      })
      .build();
    const events = watch(agent);
    try {
      await expect(agent.run({ message: 'Read synthetic rows.' })).rejects.toThrow(
        'Deliberate synthetic discovery failure.',
      );
      expect(requests).toBe(0);
      expect(writeRows(events)).toHaveLength(2);
      for (const row of writeRows(events))
        expect(row).toMatchObject({ checked: 0, findings: 0, notApplicable: 0, unreachable: 0 });
      expect(events.some((event) => event.type === 'agentfootprint.tools.rowset_checked')).toBe(
        false,
      );
    } finally {
      await agent.shutdown();
    }
  });

  it('a provider-only argument ask accounts NA then reacquires its current catalog on executing resume', async () => {
    let calls = 0;
    const tool = defineTool({
      name: 'read_catalog_rows',
      description: 'Read synthetic rows.',
      resultRowsets: rowset('first'),
      inputSchema: { type: 'object', properties: { vm: { type: 'string' } }, required: ['vm'] },
      askOrAssume: { vm: { ask: 'Which VM?' } },
      execute: () => {
        calls++;
        return { first: [{ value: 0 }] };
      },
    });
    let current: Tool = tool;
    let lists = 0;
    const executed: string[] = [];
    const agent = Agent.create({
      answerLayer: false,
      model: 'mock',
      checkColumnTypes: 'warn',
      integrityPosture: 'dev',
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'held-catalog-call', name: 'read_catalog_rows', args: { vm: 'fixture-vm' } },
            ],
          },
          'Done.',
        ],
      }),
    })
      .toolProvider({
        id: 'catalog-provider',
        list: () => {
          lists++;
          return [current];
        },
      })
      .inputsLayer()
      .findings({ argumentSources: true })
      .build();
    const events = watch(agent);
    try {
      const paused = await agent.run({ message: 'Read disks for fixture-vm.' });
      expect(isPaused(paused)).toBe(true);
      if (!isPaused(paused)) throw new Error('Expected the native argument checkpoint.');
      expect(calls).toBe(0);
      for (const row of writeRows(events))
        expect(row).toMatchObject({ checked: 0, findings: 0, notApplicable: 1, unreachable: 0 });
      expect(events.some((event) => event.type === 'agentfootprint.tools.rowset_checked')).toBe(
        false,
      );
      const input = (paused.checkpoint.pauseData as { awaitingInput: AwaitingInput }).awaitingInput;
      expect(input.fields).toHaveLength(1);
      current = defineTool({
        name: 'read_catalog_rows',
        description: 'Read synthetic rows.',
        resultRowsets: rowset('second'),
        inputSchema: { type: 'object', properties: { vm: { type: 'string' } }, required: ['vm'] },
        askOrAssume: { vm: { ask: 'Which VM?' } },
        execute(args) {
          executed.push(String(args.vm));
          return { second: [{ value: 'wrong-current-type' }] };
        },
      });
      const boundary = events.length;
      expect(
        await agent.resume(paused.checkpoint, {
          requestId: input.requestId,
          values: { [input.fields[0]!.id]: 'fresh-fixture-vm' },
        }),
      ).toBe('Done.');
      expect(lists).toBeGreaterThanOrEqual(2);
      expect(calls).toBe(0);
      expect(executed).toEqual(['fresh-fixture-vm']);
      expect(columnFindings(events.slice(boundary)).map((row) => row.rowset)).toEqual(['second']);
      expect(
        events
          .slice(boundary)
          .filter((event) => event.type === 'agentfootprint.tools.rowset_checked'),
      ).toHaveLength(1);
    } finally {
      await agent.shutdown();
    }
  });
});
