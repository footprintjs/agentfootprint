/**
 * Declare-and-push wiring — the agent resolves a tool's declared credential
 * BEFORE invoking and injects `ctx.credential`. Covers the behaviour the panel
 * required: injection, fail-closed, no-leak (incl. emit payloads), the LLM never
 * sees the credential, and a throwing provider is surfaced (not retried).
 */

import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src/index.js';
import { staticTokens, type CredentialProvider } from '../../src/identity.js';

interface RunOut {
  answer: string;
  events: Array<{ name: string; payload: Record<string, unknown> }>;
  snapshot: string;
  narrative: string;
}

async function runWithTool(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any,
  credentials?: CredentialProvider,
): Promise<RunOut> {
  const events: RunOut['events'] = [];
  const probe = {
    id: 'probe',
    onEmit: (e: { name: string; payload: Record<string, unknown> }) =>
      events.push({ name: e.name, payload: e.payload }),
  };
  const agent = Agent.create({
    provider: mock({
      replies: [
        { content: 'calling', toolCalls: [{ id: 'c1', name: tool.schema.name, args: {} }] },
        { content: 'done', toolCalls: [] },
      ],
    }),
    model: 'mock',
    maxIterations: 3,
    ...(credentials && { credentials }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
    .tools([tool])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .recorder(probe as any)
    .build();
  const answer = await agent.run({ message: 'go' });
  return {
    answer: String(answer),
    events,
    snapshot: JSON.stringify(agent.getSnapshot() ?? {}),
    narrative: JSON.stringify(agent.getLastNarrativeEntries()),
  };
}

const SECRET = 'ghp_decl_push_secret_0001';

describe('declare-and-push — injection', () => {
  it('resolves the declared need and injects ctx.credential (tool applies it)', async () => {
    let appliedAuth = '';
    let sawHasCredentials = false;
    const tool = defineTool({
      name: 'list_repos',
      description: 'list',
      inputSchema: { type: 'object', properties: {} },
      needs: { credential: 'github', scopes: ['repo'] },
      execute: async (_args, ctx) => {
        sawHasCredentials = ctx.hasCredentials;
        appliedAuth = ctx.credential ? ctx.credential.toHeaders().authorization! : '(none)';
        return 'ok';
      },
    });
    const out = await runWithTool(tool, staticTokens({ github: SECRET }));
    expect(appliedAuth).toBe(`Bearer ${SECRET}`); // pushed in, used locally
    expect(sawHasCredentials).toBe(true);
    const names = out.events.map((e) => e.name);
    expect(names).toContain('agentfootprint.credential.requested');
    expect(names).toContain('agentfootprint.credential.acquired');
  });
});

describe('declare-and-push — security', () => {
  it('the secret never appears in the snapshot, narrative, or any emit payload', async () => {
    const tool = defineTool({
      name: 'check',
      description: 'check',
      inputSchema: { type: 'object', properties: {} },
      needs: { credential: 'github' },
      execute: async (_args, ctx) => `headers:${Object.keys(ctx.credential!.toHeaders()).length}`,
    });
    const out = await runWithTool(tool, staticTokens({ github: SECRET }));
    expect(out.snapshot).not.toContain(SECRET);
    expect(out.narrative).not.toContain(SECRET);
    expect(JSON.stringify(out.events)).not.toContain(SECRET); // emit payloads carry kind, not the token
    const acquired = out.events.find((e) => e.name === 'agentfootprint.credential.acquired');
    expect(acquired?.payload.kind).toBe('bearer'); // metadata only
    expect(acquired?.payload).not.toHaveProperty('token');
  });

  it('fail-closed: a declared need with NO provider → loud error, tool does NOT run', async () => {
    let ran = false;
    const tool = defineTool({
      name: 'needs_cred',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      needs: { credential: 'github' },
      execute: async () => {
        ran = true;
        return 'should not run';
      },
    });
    const out = await runWithTool(tool); // no credentials attached
    expect(ran).toBe(false); // fail-closed — never half-authed
    const failed = out.events.find((e) => e.name === 'agentfootprint.credential.failed');
    expect(failed).toBeTruthy();
    expect(out.snapshot).toMatch(/No credential provider configured/i); // surfaced to the LLM as the tool result
  });
});

describe('declare-and-push — the LLM never sees the credential', () => {
  it('the credential is not in the tool input schema sent to the model', () => {
    const tool = defineTool({
      name: 't',
      description: 'x',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      needs: { credential: 'github', scopes: ['repo'] },
      execute: async () => 'x',
    });
    expect(JSON.stringify(tool.schema.inputSchema)).not.toMatch(/github|credential|token/i);
  });
});

describe('declare-and-push — failure surfaced, not retried', () => {
  it('a throwing provider is surfaced once (no denial-hammering)', async () => {
    let calls = 0;
    const denyingProvider: CredentialProvider = {
      id: 'deny',
      getCredential: () => {
        calls += 1;
        return Promise.reject(new Error('access_denied'));
      },
    };
    const tool = defineTool({
      name: 'deny_tool',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      needs: { credential: 'github' },
      execute: async () => 'should not run',
    });
    const out = await runWithTool(tool, denyingProvider);
    expect(calls).toBe(1); // resolved once, NOT retried (denial is not hammered)
    expect(out.snapshot).toMatch(/access_denied/);
    expect(out.events.some((e) => e.name === 'agentfootprint.credential.failed')).toBe(true);
  });
});
