/**
 * `codeRunsOf(tool)` — the published map of a code runner's facts, keyed by
 * call id — behaves exactly as it did before the script record existed, for a
 * call an agent dispatched too:
 *
 *   - the runner files every run there (`codeRuns.set(ctx.toolCallId, …)`);
 *   - a wrapper that awaits the inner runner reads the facts back by the call
 *     id it was handed, inside its own `execute`;
 *   - after a code runner the agent dispatched directly returns, the dispatch
 *     loop takes its entry off the map and emits `agentfootprint.tools.code_run`.
 *
 * The script record attests from the dispatch's own copy (`CODE_RUN_SLOT`),
 * never from this map — so two runs that share a call id cannot trade facts
 * there (`test/core/agent/evidence/script-attestation.test.ts`). Both options
 * are OFF here: nothing of the script record is armed.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  checkInApproved,
  codeRunnerTool,
  codeRunsOf,
  defineTool,
  isPaused,
} from '../../src/index.js';
import { pausedRequest } from '../helpers/pausedRequest.js';
import { mock } from '../../src/llm-providers.js';
import type { CodeResult } from '../../src/provider-contract/types.js';

function runner(result: CodeResult) {
  return {
    id: 'answering',
    start: () =>
      Promise.resolve({
        id: 's1',
        execute: () => Promise.resolve(result),
        stop: () => Promise.resolve(),
      }),
  };
}

const failing = { ok: false, exitCode: 7, stdout: '', stderr: 'boom' } as const;

describe('codeRunsOf — the published map, with neither script option on', () => {
  it('a wrapper that awaits the inner runner reads the exit facts by the call id it was handed', async () => {
    const inner = codeRunnerTool({ runner: runner(failing) });
    const read: unknown[] = [];
    const wrapper = defineTool<{ code: string }, string>({
      name: 'run_wrapped',
      description: 'Runs a program through the code runner.',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      execute: async (args, ctx) => {
        const out = await inner.execute(args, ctx);
        read.push(codeRunsOf(inner)?.get(ctx.toolCallId));
        return out;
      },
    });
    const events: unknown[] = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'w1', name: 'run_wrapped', args: { code: 'print(1)' } }] },
          { content: 'Done.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(wrapper)
      .watch({
        id: 'code-runs',
        onEmit: (e: { name: string; payload?: unknown }) => {
          if (e.name === 'agentfootprint.tools.code_run') events.push(e.payload);
        },
      })
      .build();
    await agent.run('go');
    expect(read).toEqual([expect.objectContaining({ ok: false, exitCode: 7 })]);
    // The dispatched tool is the wrapper, not a code runner: no code_run, as before.
    expect(events).toEqual([]);
  });

  it('a code runner dispatched directly: its entry is taken off the map, and code_run fires once', async () => {
    const tool = codeRunnerTool({ runner: runner(failing) });
    const events: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'run_code', args: { code: 'print(1)' } }] },
          { content: 'Done.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(tool)
      .watch({
        id: 'code-runs',
        onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
          if (e.name === 'agentfootprint.tools.code_run') events.push(e.payload ?? {});
        },
      })
      .build();
    await agent.run('go');
    expect(codeRunsOf(tool)?.size).toBe(0);
    expect(events).toEqual([expect.objectContaining({ tool: 'run_code', exitCode: 7 })]);
  });

  it('a decorated runner handed a context of its own: code_run still fires once, from the map, as before', async () => {
    // `{ ...runner }` keeps the runner's map (a symbol key), so the dispatch
    // loop recognizes a code runner — and the decorator hands the runner a
    // context it built itself: every public field, none of the library's
    // symbol-keyed ports (`Object.entries` reads string keys only), so this
    // dispatch's slot never reaches the runner. The event fires as it always
    // did, from the map's entry for the call id; the script record, armed or
    // not, never attests from that map.
    const inner = codeRunnerTool({ runner: runner(failing) });
    const decorated = {
      ...inner,
      execute: (args: { code: string }, ctx: object) =>
        inner.execute(args, Object.fromEntries(Object.entries(ctx)) as never),
    };
    for (const armed of [false, true]) {
      const events: Array<Record<string, unknown>> = [];
      const built = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'c1', name: 'run_code', args: { code: 'print(1)' } }] },
            { content: 'Done.' },
          ] as never,
        }),
        model: 'mock',
      })
        .tool(decorated as never)
        .watch({
          id: 'code-runs',
          onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
            if (e.name === 'agentfootprint.tools.code_run') events.push(e.payload ?? {});
          },
        });
      const agent = (armed ? built.scriptTravelsWithTheAnswer() : built).build();
      await agent.run('go');
      expect(events).toEqual([expect.objectContaining({ tool: 'run_code', exitCode: 7 })]);
      expect(codeRunsOf(inner)?.size).toBe(0);
      if (armed) {
        const ledger = (agent.getLastSnapshot()?.sharedState as { findingsLedger?: unknown[] })
          ?.findingsLedger;
        const rows = (ledger ?? []).filter((r) => (r as { kind?: unknown }).kind === 'script');
        // The map's entry is keyed by an id another run may share: never attested from.
        expect(rows).toEqual([expect.objectContaining({ outcome: 'returned' })]);
      }
    }
  });

  it('a code runner resumed after a check-in: code_run fires once, and the map keeps its entry, as before', async () => {
    const tool = codeRunnerTool({ runner: runner(failing), checkIn: 'always' });
    const events: unknown[] = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'run_code', args: { code: 'print(1)' } }] },
          { content: 'Done.' },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(tool)
      .watch({
        id: 'code-runs',
        onEmit: (e: { name: string; payload?: unknown }) => {
          if (e.name === 'agentfootprint.tools.code_run') events.push(e.payload);
        },
      })
      .build();
    const first = await agent.run('go');
    expect(isPaused(first)).toBe(true);
    if (!isPaused(first)) return;
    await agent.resume(
      first.checkpoint,
      checkInApproved({ request: pausedRequest(first), by: 'alice' }),
    );
    expect(events).toEqual([expect.objectContaining({ tool: 'run_code', exitCode: 7 })]);
    // The resume boundary never took entries off the published map.
    expect(codeRunsOf(tool)?.get('c1')).toMatchObject({ exitCode: 7 });
  });
});
