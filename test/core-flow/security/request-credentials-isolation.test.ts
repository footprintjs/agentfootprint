/**
 * One request's credential never serves another request.
 *
 * Threat model: other users of the process are untrusted. A request-sourced
 * credential must reach only the tool calls of the run that carried it —
 * across concurrent runs, across composition members (nested), across a
 * pause and its resume, and never through a footprintjs subflow that no run
 * handed a request. Where no request reaches a call, the call is refused by
 * name; nothing is borrowed.
 */

import { flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { Agent, Parallel, Sequence, defineTool, pauseHere } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { requestContext, requestCredentials } from '../../../src/doors/security.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

const ALICE: MemoryIdentity = { tenant: 't', principal: 'alice', conversationId: 'c-a' };
const BOB: MemoryIdentity = { tenant: 't', principal: 'bob', conversationId: 'c-b' };
const ALICE_TOKEN = 'alice-req-token-0c41f2';
const BOB_TOKEN = 'bob-req-token-9e77d3';

/** ONE provider for the whole process — built at boot, holding no secret. */
const credentials = requestCredentials({ services: { crm: 'crmToken' } });

interface Seen {
  readonly member: string;
  readonly principal?: string;
  readonly auth?: string;
  readonly refused?: string;
}

/** An agent whose one tool reports the credential it was handed, for whom. */
function member(id: string, seen: Seen[], gate?: Promise<void>) {
  const whoAmI = defineTool({
    name: 'crm_lookup',
    description: 'Looks something up in the CRM.',
    inputSchema: { type: 'object', properties: {} },
    needs: { credential: 'crm' },
    execute: async (_args, ctx) => {
      if (gate !== undefined) await gate;
      seen.push({
        member: id,
        ...(ctx.identity?.principal !== undefined && { principal: ctx.identity.principal }),
        ...(ctx.credential && { auth: ctx.credential.toHeaders().authorization }),
      });
      return 'noted';
    },
  });
  return Agent.create({
    id,
    provider: mock({
      chunkDelayMs: 1,
      respond: (req) => {
        const tool = [...req.messages].reverse().find((m) => m.role === 'tool');
        if (tool === undefined)
          return { toolCalls: [{ id: `t-${id}`, name: 'crm_lookup', args: {} }] };
        const text = typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content);
        if (text.includes('credential error')) seen.push({ member: id, refused: text });
        return { content: 'ok' };
      },
    }),
    model: 'mock',
    maxIterations: 3,
    credentials,
  })
    .tools([whoAmI])
    .build();
}

const requestFor = (token: string) => requestContext({ secrets: { crmToken: token } });
const bearerOf = (token: string) => `Bearer ${token}`;

describe('request credentials — concurrent runs', () => {
  it('two agents sharing one provider, two requests at once: each tool sees its own', async () => {
    const seen: Seen[] = [];
    const a = member('a', seen);
    const b = member('b', seen);
    await Promise.all([
      a.run({ message: 'go', identity: ALICE }, { request: requestFor(ALICE_TOKEN) }),
      b.run({ message: 'go', identity: BOB }, { request: requestFor(BOB_TOKEN) }),
    ]);
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.auth).toBe(bearerOf(s.principal === 'alice' ? ALICE_TOKEN : BOB_TOKEN));
    }
  });

  it('a run with no request after one with a request is refused — nothing carries over', async () => {
    const seen: Seen[] = [];
    const agent = member('m', seen);
    await agent.run({ message: 'go', identity: ALICE }, { request: requestFor(ALICE_TOKEN) });
    await agent.run({ message: 'go', identity: BOB });
    expect(seen[0]?.auth).toBe(bearerOf(ALICE_TOKEN));
    expect(seen[1]?.refused).toMatch(/credential error for 'crm'.*carries none/);
    expect(seen[1]?.refused).not.toContain(ALICE_TOKEN);
    expect(seen.filter((s) => s.auth !== undefined)).toHaveLength(1);
  });
});

describe('request credentials — composition members, nested', () => {
  /** Sequence( top → Parallel( inner, side ) ): one member at the top, two nested one level down. */
  function nested(seen: Seen[]) {
    const fan = Parallel.create({ id: 'fan' })
      .branch('inner', member('inner', seen))
      .branch('side', member('side', seen))
      .mergeWithFn((r) => Object.values(r).join(' | '))
      .build();
    return Sequence.create({ id: 'outer' })
      .step('top', member('top', seen))
      .step('fan', fan)
      .build();
  }

  it('two requests through one composition at once: every member call sees its own run’s', async () => {
    const seen: Seen[] = [];
    const flow = nested(seen);
    await Promise.all([
      flow.run({ message: 'go', identity: ALICE }, { request: requestFor(ALICE_TOKEN) }),
      flow.run({ message: 'go', identity: BOB }, { request: requestFor(BOB_TOKEN) }),
    ]);
    // Three members × two runs, every one served.
    expect(seen.filter((s) => s.auth !== undefined)).toHaveLength(6);
    expect(seen.filter((s) => s.refused !== undefined)).toEqual([]);
    for (const s of seen) {
      expect(s.auth).toBe(bearerOf(s.principal === 'alice' ? ALICE_TOKEN : BOB_TOKEN));
    }
  });

  it('a composition run with no request serves its members none', async () => {
    const seen: Seen[] = [];
    await nested(seen).run({ message: 'go', identity: ALICE });
    expect(seen.filter((s) => s.auth !== undefined)).toEqual([]);
    expect(seen.filter((s) => s.refused !== undefined)).toHaveLength(3);
  });

  it('the request never reaches the composition’s state or snapshot', async () => {
    const seen: Seen[] = [];
    const flow = nested(seen);
    await flow.run({ message: 'go', identity: ALICE }, { request: requestFor(ALICE_TOKEN) });
    expect(JSON.stringify(flow.getLastSnapshot() ?? {})).not.toContain(ALICE_TOKEN);
  });
});

describe('request credentials — a footprintjs subflow no run handed a request', () => {
  it('is refused, even while the same agent instance is mid-run with a request', async () => {
    const seen: Seen[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const agent = member('shared', seen, gate);
    // The instance's own run, holding ALICE's request, paused inside its tool.
    const direct = agent.run(
      { message: 'go', identity: ALICE },
      { request: requestFor(ALICE_TOKEN) },
    );
    // Meanwhile a caller-built chart mounts the SAME instance for BOB.
    const chart = flowChart<{ msg: string }>(
      'Start',
      (scope) => {
        scope.msg = 'hello';
      },
      'start',
    )
      .addSubFlowChartNext('sf-agent', agent.getSpec(), 'Agent', {
        inputMapper: () => ({ message: 'go', identity: BOB }),
      })
      .build();
    const { FlowChartExecutor } = await import('footprintjs');
    const mounted = new FlowChartExecutor(chart).run({ input: {} });
    // Let the mount's own tool call through the gate only after the direct
    // run is in flight, then release both.
    await new Promise((r) => setTimeout(r, 20));
    release();
    await Promise.all([direct, mounted]);
    const bobs = seen.filter(
      (s) => s.principal === 'bob' || (s.refused !== undefined && s.principal === undefined),
    );
    // The mount's call was served nothing and refused by name…
    expect(seen.find((s) => s.principal === 'bob' && s.auth !== undefined)).toBeUndefined();
    expect(seen.some((s) => s.refused !== undefined)).toBe(true);
    // …while the direct run got ALICE's own.
    expect(seen.find((s) => s.principal === 'alice')?.auth).toBe(bearerOf(ALICE_TOKEN));
    expect(JSON.stringify(bobs)).not.toContain(ALICE_TOKEN);
  });
});

describe('request credentials — pause and resume', () => {
  function pausing(seen: Seen[]) {
    const ask = defineTool({
      name: 'ask_approval',
      description: 'Ask a person.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => pauseHere({ question: 'ok?' }),
    });
    const lookup = defineTool({
      name: 'crm_lookup',
      description: 'Looks something up.',
      inputSchema: { type: 'object', properties: {} },
      needs: { credential: 'crm' },
      execute: async (_args, ctx) => {
        seen.push({
          member: 'p',
          ...(ctx.credential && { auth: ctx.credential.toHeaders().authorization }),
        });
        return 'noted';
      },
    });
    return Agent.create({
      provider: mock({
        respond: (req) => {
          const tools = req.messages.filter((m) => m.role === 'tool');
          if (tools.length === 0)
            return { toolCalls: [{ id: 'a1', name: 'ask_approval', args: {} }] };
          if (tools.length === 1)
            return { toolCalls: [{ id: 'l1', name: 'crm_lookup', args: {} }] };
          const last = tools[tools.length - 1]!;
          const text =
            typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
          if (text.includes('credential error')) seen.push({ member: 'p', refused: text });
          return { content: 'done' };
        },
      }),
      model: 'mock',
      maxIterations: 5,
      credentials,
    })
      .tools([ask, lookup])
      .build();
  }

  it('the resumed leg serves the RESUMING request; the checkpoint carries none', async () => {
    const seen: Seen[] = [];
    const agent = pausing(seen);
    const paused = await agent.run({ message: 'go' }, { request: requestFor(ALICE_TOKEN) });
    expect((paused as { paused?: boolean }).paused).toBe(true);
    const checkpoint = (paused as { checkpoint: Parameters<typeof agent.resume>[0] }).checkpoint;
    expect(JSON.stringify(checkpoint)).not.toContain(ALICE_TOKEN);
    await agent.resume(checkpoint, 'yes', { request: requestFor(BOB_TOKEN) });
    expect(seen).toEqual([{ member: 'p', auth: bearerOf(BOB_TOKEN) }]);
  });

  it('a resume with no request is refused — the paused run’s request is not kept', async () => {
    const seen: Seen[] = [];
    const agent = pausing(seen);
    const paused = await agent.run({ message: 'go' }, { request: requestFor(ALICE_TOKEN) });
    const checkpoint = (paused as { checkpoint: Parameters<typeof agent.resume>[0] }).checkpoint;
    await agent.resume(checkpoint, 'yes');
    expect(seen.filter((s) => s.auth !== undefined)).toEqual([]);
    expect(seen[0]?.refused).toMatch(/carries none/);
  });
});
