/**
 * Identity feature — the 7 test types (Convention 3) for the CredentialProvider
 * port + `staticTokens()` / `agentCoreIdentity()` adapters.
 *
 * The headline is the SECURITY test: a vended token used locally inside a tool
 * must NEVER appear in the run snapshot or narrative (the panel's blocking
 * requirement — tracked writes leak to the commit log / recorders / observability).
 */

import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src/index.js';
import { staticTokens, agentCoreIdentity, isCredentialToken } from '../../src/identity.js';
import type { AgentCoreIdentityClientLike, AgentCoreOauthResponse } from '../../src/identity.js';

/** Fake AgentCore identity client: records inputs, returns a scripted response. */
function fakeClient(resp: AgentCoreOauthResponse): {
  client: AgentCoreIdentityClientLike;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    client: {
      getResourceOauth2Token: (input) => {
        calls.push(input as Record<string, unknown>);
        return Promise.resolve(resp);
      },
    },
  };
}

// ─── Unit ────────────────────────────────────────────────────────────
describe('identity — Unit', () => {
  it('isCredentialToken discriminates the result union', () => {
    expect(isCredentialToken({ status: 'token', token: 't' })).toBe(true);
    expect(
      isCredentialToken({
        status: 'authorization-required',
        authorizationUrl: 'u',
        sessionId: 's',
      }),
    ).toBe(false);
  });

  it('staticTokens returns the configured token and rejects unknown services', async () => {
    const p = staticTokens({ github: 'ghp_x' }, { expiresAt: 123 });
    await expect(p.getCredential({ service: 'github' })).resolves.toEqual({
      status: 'token',
      token: 'ghp_x',
      expiresAt: 123,
    });
    await expect(p.getCredential({ service: 'slack' })).rejects.toThrow(/no token.*slack/i);
  });

  it('agentCoreIdentity maps the request onto GetResourceOauth2Token input', async () => {
    const { client, calls } = fakeClient({ accessToken: 'tok' });
    const p = agentCoreIdentity({ _client: client, workloadIdentityToken: 'wit' });
    await p.getCredential({
      service: 'google',
      mode: 'user',
      scopes: ['drive'],
      forceReauth: true,
    });
    expect(calls[0]).toEqual({
      resourceCredentialProviderName: 'google',
      scopes: ['drive'],
      oauth2Flow: 'USER_FEDERATION',
      forceAuthentication: true,
      workloadIdentityToken: 'wit',
    });
  });

  it('agentCoreIdentity defaults to M2M when mode is omitted', async () => {
    const { client, calls } = fakeClient({ accessToken: 'tok' });
    await agentCoreIdentity({ _client: client }).getCredential({ service: 'svc' });
    expect(calls[0]!.oauth2Flow).toBe('M2M');
    expect(calls[0]!.forceAuthentication).toBe(false);
  });

  it('agentCoreIdentity maps responses (token / authorization-required / neither→throws)', async () => {
    const tok = await agentCoreIdentity({
      _client: fakeClient({ accessToken: 'a', expiresAt: 9 }).client,
    }).getCredential({ service: 's' });
    expect(tok).toEqual({ status: 'token', token: 'a', expiresAt: 9 });

    const consent = await agentCoreIdentity({
      _client: fakeClient({ authorizationUrl: 'https://consent', sessionId: 'sess1' }).client,
    }).getCredential({ service: 's', mode: 'user' });
    expect(consent).toEqual({
      status: 'authorization-required',
      authorizationUrl: 'https://consent',
      sessionId: 'sess1',
    });

    await expect(
      agentCoreIdentity({ _client: fakeClient({}).client }).getCredential({ service: 's' }),
    ).rejects.toThrow(/neither an access token nor an authorization URL/i);
  });
});

// ─── Functional ──────────────────────────────────────────────────────
describe('identity — Functional', () => {
  it('a token resolved end-to-end is usable as a Bearer header', async () => {
    const p = staticTokens({ api: 'secret-123' });
    const r = await p.getCredential({ service: 'api' });
    expect(isCredentialToken(r) && `Bearer ${r.token}`).toBe('Bearer secret-123');
  });
});

// ─── Integration ─────────────────────────────────────────────────────
describe('identity — Integration', () => {
  it('a tool resolves a credential and uses it to call a (mock) downstream', async () => {
    let sentHeader = '';
    const credentials = staticTokens({ github: 'ghp_int' });
    const callGitHub = defineTool({
      name: 'count_repos',
      description: 'Count GitHub repos for the user.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const r = await credentials.getCredential({ service: 'github', mode: 'user' });
        if (r.status !== 'token') return `authorize first: ${r.authorizationUrl}`;
        sentHeader = `Bearer ${r.token}`; // used locally, not stored in scope
        return 'repos: 7';
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { content: 'checking', toolCalls: [{ id: 'c1', name: 'count_repos', args: {} }] },
          { content: 'You have 7 repos.', toolCalls: [] },
        ],
      }),
      model: 'mock',
      maxIterations: 3,
    })
      .tools([callGitHub])
      .build();
    const answer = await agent.run({ message: 'how many repos?' });
    expect(sentHeader).toBe('Bearer ghp_int'); // the tool actually used the token
    expect(String(answer)).toContain('7');
  });

  it('3LO with no cached token surfaces an authorization URL to the caller', async () => {
    const p = agentCoreIdentity({
      _client: fakeClient({ authorizationUrl: 'https://idp/consent?x=1', sessionId: 's9' }).client,
    });
    const r = await p.getCredential({ service: 'github', mode: 'user' });
    expect(r.status).toBe('authorization-required');
    if (r.status === 'authorization-required') expect(r.authorizationUrl).toMatch(/^https:\/\//);
  });
});

// ─── Property ────────────────────────────────────────────────────────
describe('identity — Property', () => {
  it('staticTokens returns the configured token verbatim for any service id', async () => {
    const services = ['a', 'GitHub', 'svc.with.dots', 'x-y_z', '🦄', 'a'.repeat(200)];
    for (const s of services) {
      const tok = `tok::${s}`;
      const r = await staticTokens({ [s]: tok }).getCredential({ service: s });
      expect(isCredentialToken(r) && r.token).toBe(tok);
    }
  });

  it('agentCoreIdentity passes scopes through verbatim', async () => {
    for (const scopes of [[], ['a'], ['a', 'b', 'c'], ['repo', 'read:org']]) {
      const { client, calls } = fakeClient({ accessToken: 't' });
      await agentCoreIdentity({ _client: client }).getCredential({ service: 's', scopes });
      expect(calls[0]!.scopes).toEqual(scopes);
    }
  });
});

// ─── Security (the blocking requirement) ─────────────────────────────
describe('identity — Security', () => {
  it('a vended token used locally in a tool never reaches the snapshot or narrative', async () => {
    const SECRET = 'ghp_super_secret_value_should_never_be_traced_9876543210';
    const credentials = staticTokens({ github: SECRET });
    const tool = defineTool({
      name: 'check',
      description: 'Use a credential locally; return only a non-secret result.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const r = await credentials.getCredential({ service: 'github' });
        // use the token locally; return ONLY a derived, non-secret value
        const len = isCredentialToken(r) ? r.token.length : 0;
        return `checked (token length ${len})`;
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { content: 'go', toolCalls: [{ id: 'c1', name: 'check', args: {} }] },
          { content: 'done', toolCalls: [] },
        ],
      }),
      model: 'mock',
      maxIterations: 3,
    })
      .tools([tool])
      .build();

    await agent.run({ message: 'check' });

    const snapshot = JSON.stringify(agent.getSnapshot() ?? {});
    const narrative = JSON.stringify(agent.getLastNarrativeEntries());
    expect(snapshot).not.toContain(SECRET); // not in commit log / memory / recorder snapshots
    expect(narrative).not.toContain(SECRET); // not in the narrative
    // sanity: the tool DID run (derived value is present), proving the token was used
    expect(snapshot + narrative).toContain('token length');
  });
});

// ─── Performance ─────────────────────────────────────────────────────
describe('identity — Performance', () => {
  it('staticTokens.getCredential is O(1) — 2000 calls finish well under budget', async () => {
    const p = staticTokens({ s: 'tok' });
    const start = Date.now();
    for (let i = 0; i < 2000; i++) await p.getCredential({ service: 's' });
    expect(Date.now() - start).toBeLessThan(1000); // generous ceiling — avoids flakiness
  });
});

// ─── Load ────────────────────────────────────────────────────────────
describe('identity — Load', () => {
  it('resolves 500 concurrent getCredential calls correctly', async () => {
    const p = staticTokens({ a: 'TA', b: 'TB' });
    const reqs = Array.from({ length: 500 }, (_, i) => (i % 2 === 0 ? 'a' : 'b'));
    const results = await Promise.all(reqs.map((service) => p.getCredential({ service })));
    results.forEach((r, i) => {
      expect(isCredentialToken(r) && r.token).toBe(reqs[i] === 'a' ? 'TA' : 'TB');
    });
  });
});
