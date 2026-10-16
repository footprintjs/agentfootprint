/**
 * The doors a request crosses — and the ones it must not.
 *
 * Threat model: a link is a key to its run's identity and request; a served
 * MCP call belongs to no run; a resume names the request it serves, and two
 * resumes of one open run must not hand its members two requests.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  Sequence,
  defineTool,
  pauseHere,
  ResumeRequestConflictError,
} from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { requestContext, requestCredentials } from '../../../src/doors/security.js';
import { mcpServe } from '../../../src/mcp/mcpServe.js';
import {
  closeParentRun,
  openParentRun,
  readsParentRun,
  reopenParentRun,
  withParentRun,
} from '../../../src/core/memberRun.js';

const TOKEN = 'served-req-token-51a7c9';
const credentials = requestCredentials({ services: { crm: 'crmToken' } });

describe('withParentRun — a link only this module hands down', () => {
  it('drops a parentRun a mapper or an earlier step put in the input when there is no run', () => {
    const runner = {};
    readsParentRun(runner);
    const run = openParentRun('run-1-1', undefined, 'test');
    try {
      const forged = withParentRun({ message: 'x', parentRun: run.link }, undefined, runner);
      expect(Object.hasOwn(forged, 'parentRun')).toBe(false);
      expect(withParentRun({ message: 'x' }, run, runner)).toEqual({
        message: 'x',
        parentRun: run.link,
      });
    } finally {
      closeParentRun(run);
    }
  });
});

describe('reopenParentRun — one open run, one request', () => {
  it('refuses a second leg naming another request while the run is still open', () => {
    const a = requestContext({ secrets: { crmToken: 'a' } });
    const b = requestContext({ secrets: { crmToken: 'b' } });
    const open = openParentRun('run-1-2', undefined, 'test', a);
    const state = { memberRun: { link: open.link, runId: open.runId } };
    try {
      expect(() => reopenParentRun(state, 'Sequence.resume', b)).toThrow(
        ResumeRequestConflictError,
      );
      const same = reopenParentRun(state, 'Sequence.resume', a);
      closeParentRun(same);
    } finally {
      closeParentRun(open);
    }
  });
});

describe('a composition resumed with a new request', () => {
  it('its member serves the RESUMING request', async () => {
    const auths: string[] = [];
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
        auths.push(ctx.credential?.toHeaders().authorization ?? '(none)');
        return 'noted';
      },
    });
    const member = Agent.create({
      provider: mock({
        respond: (req) => {
          const tools = req.messages.filter((m) => m.role === 'tool').length;
          if (tools === 0) return { toolCalls: [{ id: 'a1', name: 'ask_approval', args: {} }] };
          if (tools === 1) return { toolCalls: [{ id: 'l1', name: 'crm_lookup', args: {} }] };
          return { content: 'done' };
        },
      }),
      model: 'mock',
      maxIterations: 5,
      credentials,
    })
      .tools([ask, lookup])
      .build();
    const flow = Sequence.create({ id: 'outer' }).step('m', member).build();
    const paused = await flow.run(
      { message: 'go' },
      { request: requestContext({ secrets: { crmToken: 'alice-token-aaaa' } }) },
    );
    const checkpoint = (paused as { checkpoint: Parameters<typeof flow.resume>[0] }).checkpoint;
    expect(JSON.stringify(checkpoint)).not.toContain('alice-token-aaaa');
    await flow.resume(checkpoint, 'yes', {
      request: requestContext({ secrets: { crmToken: 'bob-token-bbbb' } }),
    });
    expect(auths).toEqual(['Bearer bob-token-bbbb']);
  });

  it('a malformed request is refused before the resume moves anything', async () => {
    const member = Agent.create({ provider: mock({ reply: 'hi' }), model: 'mock' }).build();
    const flow = Sequence.create({ id: 's' }).step('m', member).build();
    const resumed: unknown[] = [];
    flow.on('agentfootprint.pause.resume', (e) => resumed.push(e));
    await expect(
      flow.resume({ sharedState: {} } as never, 'yes', { request: { a: TOKEN } as never }),
    ).rejects.toThrow(/Sequence\.resume: `request` must be built by requestContext/);
    expect(resumed).toEqual([]);
  });
});

describe('mcpServe — a served call carries no request', () => {
  it('a request a tool presents is removed; the request credential fails closed', async () => {
    const handlers = new Map<string, (req: unknown, extra: unknown) => Promise<unknown>>();
    const server = {
      setRequestHandler(
        schema: unknown,
        handler: (req: unknown, extra: unknown) => Promise<unknown>,
      ) {
        handlers.set((schema as { method: string }).method, handler);
      },
      connect: async () => {},
      close: async () => {},
    };
    // A tool holding SOME request handle tries to present it.
    const stolen = requestContext({ secrets: { crmToken: TOKEN } });
    let outcome = '';
    const tool = defineTool({
      name: 'presenter',
      description: 'presents a request',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, ctx) => {
        outcome = await ctx.credentials
          .getCredential({ service: 'crm', request: stolen })
          .then(() => 'issued')
          .catch((e: Error) => e.message);
        return 'ok';
      },
    });
    await mcpServe([tool], { _server: server as never, credentials });
    await handlers.get('tools/call')?.({ params: { name: 'presenter', arguments: {} } }, {});
    expect(outcome).toMatch(/carries none/);
    expect(outcome).not.toContain(TOKEN);
  });
});
