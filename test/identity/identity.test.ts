/**
 * Identity feature — the 7 test types (Convention 3) for the Credential protocol
 * + kinds (bearer/apiKey/basic/headers) + `staticTokens()` / `agentCoreIdentity()`.
 *
 * Headline SECURITY test: a vended credential used locally in a tool must NEVER
 * appear in the run snapshot or narrative (tracked writes leak to commit log /
 * recorders / observability).
 */

import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src/index.js';
import {
  staticTokens,
  agentCoreIdentity,
  isCredentialIssued,
  bearer,
  apiKey,
  basic,
  headers,
} from '../../src/identity.js';
import type { AgentCoreIdentityClientLike, AgentCoreOauthResponse } from '../../src/identity.js';

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

// ─── Unit: kinds (the Credential protocol — toHeaders is universal) ───
describe('identity — Unit (kinds)', () => {
  it('bearer → Authorization: Bearer', () => {
    const c = bearer('abc');
    expect(c.kind).toBe('bearer');
    expect(c.token).toBe('abc');
    expect(c.toHeaders()).toEqual({ authorization: 'Bearer abc' });
  });
  it('apiKey → single header (default + custom name)', () => {
    expect(apiKey('k').toHeaders()).toEqual({ 'x-api-key': 'k' });
    expect(apiKey('k', 'x-internal').toHeaders()).toEqual({ 'x-internal': 'k' });
  });
  it('basic → Authorization: Basic base64(user:pass)', () => {
    const c = basic('u', 'p');
    expect(c.kind).toBe('basic');
    expect(c.toHeaders().authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });
  it('headers → the universal escape (any auth as headers, copied)', () => {
    const src = { 'x-a': '1' };
    const c = headers(src);
    expect(c.toHeaders()).toEqual({ 'x-a': '1' });
    (src as Record<string, string>)['x-a'] = 'mutated';
    expect(c.toHeaders()).toEqual({ 'x-a': '1' }); // defensive copy
  });
});

// ─── Unit: providers ────────────────────────────────────────────────
describe('identity — Unit (providers)', () => {
  it('isCredentialIssued discriminates the result union', () => {
    expect(isCredentialIssued({ status: 'issued', credential: bearer('t') })).toBe(true);
    expect(
      isCredentialIssued({
        status: 'authorization-required',
        authorizationUrl: 'u',
        sessionId: 's',
      }),
    ).toBe(false);
  });

  it('staticTokens: string → bearer; Credential → as-is; unknown service rejects', async () => {
    const p = staticTokens({ github: 'ghp_x', internal: apiKey('k') }, { expiresAt: 123 });
    const gh = await p.getCredential({ service: 'github' });
    expect(gh).toMatchObject({ status: 'issued', expiresAt: 123 });
    expect(isCredentialIssued(gh) && gh.credential.toHeaders()).toEqual({
      authorization: 'Bearer ghp_x',
    });
    const internal = await p.getCredential({ service: 'internal' });
    expect(isCredentialIssued(internal) && internal.credential.kind).toBe('apiKey');
    await expect(p.getCredential({ service: 'slack' })).rejects.toThrow(/no credential.*slack/i);
  });

  it('agentCoreIdentity maps request → GetResourceOauth2Token input', async () => {
    const { client, calls } = fakeClient({ accessToken: 'tok' });
    await agentCoreIdentity({ _client: client, workloadIdentityToken: 'wit' }).getCredential({
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

  it('agentCoreIdentity: accessToken → issued bearer; authUrl → authorization-required; neither → throws', async () => {
    const tok = await agentCoreIdentity({
      _client: fakeClient({ accessToken: 'a', expiresAt: 9 }).client,
    }).getCredential({ service: 's' });
    expect(tok).toMatchObject({ status: 'issued', expiresAt: 9 });
    expect(isCredentialIssued(tok) && tok.credential.toHeaders()).toEqual({
      authorization: 'Bearer a',
    });

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
  it('an issued credential applies as a header via the universal toHeaders()', async () => {
    const r = await staticTokens({ api: 'secret-123' }).getCredential({ service: 'api' });
    expect(isCredentialIssued(r) && r.credential.toHeaders()).toEqual({
      authorization: 'Bearer secret-123',
    });
  });
});

// ─── Integration ─────────────────────────────────────────────────────
describe('identity — Integration', () => {
  it('a tool resolves a credential and applies it to a (mock) downstream call', async () => {
    let sentHeaders: Record<string, string> = {};
    const credentials = staticTokens({ github: 'ghp_int' });
    const callGitHub = defineTool({
      name: 'count_repos',
      description: 'Count GitHub repos for the user.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const r = await credentials.getCredential({ service: 'github', mode: 'user' });
        if (!isCredentialIssued(r)) return `authorize first: ${r.authorizationUrl}`;
        sentHeaders = r.credential.toHeaders(); // used locally, not stored in scope
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
    expect(sentHeaders).toEqual({ authorization: 'Bearer ghp_int' });
    expect(String(answer)).toContain('7');
  });

  it('3LO with no cached token surfaces an authorization URL to the caller', async () => {
    const r = await agentCoreIdentity({
      _client: fakeClient({ authorizationUrl: 'https://idp/consent?x=1', sessionId: 's9' }).client,
    }).getCredential({ service: 'github', mode: 'user' });
    expect(r.status).toBe('authorization-required');
    if (r.status === 'authorization-required') expect(r.authorizationUrl).toMatch(/^https:\/\//);
  });
});

// ─── Per-request identity forwarding (workload identity scoping) ─────
//
// `GetResourceOauth2Token` has NO user/tenant field — AgentCore binds the
// user at workload-token acquisition (`GetWorkloadAccessTokenForUserId`),
// and keys its token vault + 3LO grants per (workload, user). These tests
// pin the honest forwarding: `req.identity` → per-user workload token →
// vend with it. Opt-in via `workloadName`.
describe('identity — per-request identity forwarding (agentCoreIdentity)', () => {
  function fakeWorkloadClient(resp: AgentCoreOauthResponse, userToken = 'user-scoped-token') {
    const oauthCalls: Array<Record<string, unknown>> = [];
    const workloadCalls: Array<Record<string, unknown>> = [];
    const client: AgentCoreIdentityClientLike = {
      getResourceOauth2Token: (input) => {
        oauthCalls.push(input as Record<string, unknown>);
        return Promise.resolve(resp);
      },
      getWorkloadAccessTokenForUserId: (input) => {
        workloadCalls.push(input as Record<string, unknown>);
        return Promise.resolve({ workloadAccessToken: userToken });
      },
    };
    return { client, oauthCalls, workloadCalls };
  }

  it("mode 'user' + identity.principal + workloadName → per-user workload token vends the request", async () => {
    const { client, oauthCalls, workloadCalls } = fakeWorkloadClient({ accessToken: 'tok' });
    await agentCoreIdentity({
      _client: client,
      workloadIdentityToken: 'static-wit',
      workloadName: 'my-agent',
    }).getCredential({
      service: 'github',
      mode: 'user',
      identity: { principal: 'alice', tenant: 'acme' },
    });

    // The user is bound at workload-token acquisition…
    expect(workloadCalls).toEqual([{ workloadName: 'my-agent', userId: 'alice' }]);
    // …and the vend uses the USER-SCOPED token, not the static one.
    expect(oauthCalls[0]!.workloadIdentityToken).toBe('user-scoped-token');
    expect(oauthCalls[0]!.oauth2Flow).toBe('USER_FEDERATION');
  });

  it("mode 'machine' (M2M is the workload's own identity) → identity NOT user-scoped", async () => {
    const { client, oauthCalls, workloadCalls } = fakeWorkloadClient({ accessToken: 'tok' });
    await agentCoreIdentity({
      _client: client,
      workloadIdentityToken: 'static-wit',
      workloadName: 'my-agent',
    }).getCredential({ service: 's', mode: 'machine', identity: { principal: 'alice' } });

    expect(workloadCalls).toEqual([]);
    expect(oauthCalls[0]!.workloadIdentityToken).toBe('static-wit');
  });

  it('no workloadName (the opt-in) → pre-forwarding behavior: static token, no per-user call', async () => {
    const { client, oauthCalls, workloadCalls } = fakeWorkloadClient({ accessToken: 'tok' });
    await agentCoreIdentity({
      _client: client,
      workloadIdentityToken: 'static-wit',
    }).getCredential({ service: 's', mode: 'user', identity: { principal: 'alice' } });

    expect(workloadCalls).toEqual([]);
    expect(oauthCalls[0]!.workloadIdentityToken).toBe('static-wit');
  });

  it('no identity on the request → no per-user call even with workloadName configured', async () => {
    const { client, oauthCalls, workloadCalls } = fakeWorkloadClient({ accessToken: 'tok' });
    await agentCoreIdentity({
      _client: client,
      workloadIdentityToken: 'static-wit',
      workloadName: 'my-agent',
    }).getCredential({ service: 's', mode: 'user' });

    expect(workloadCalls).toEqual([]);
    expect(oauthCalls[0]!.workloadIdentityToken).toBe('static-wit');
  });

  it('userIdFor override → tenant-qualified userId (tenant has no native AgentCore field)', async () => {
    const { client, workloadCalls } = fakeWorkloadClient({ accessToken: 'tok' });
    await agentCoreIdentity({
      _client: client,
      workloadName: 'my-agent',
      userIdFor: ({ tenant, principal }) =>
        tenant && principal ? `${tenant}:${principal}` : principal,
    }).getCredential({
      service: 's',
      mode: 'user',
      identity: { principal: 'alice', tenant: 'acme' },
    });

    expect(workloadCalls).toEqual([{ workloadName: 'my-agent', userId: 'acme:alice' }]);
  });

  it('fail-closed: workloadName configured but the client lacks getWorkloadAccessTokenForUserId → throws (no silent degrade)', async () => {
    const { client } = fakeClient({ accessToken: 'tok' }); // oauth-only client
    await expect(
      agentCoreIdentity({ _client: client, workloadName: 'my-agent' }).getCredential({
        service: 's',
        mode: 'user',
        identity: { principal: 'alice' },
      }),
    ).rejects.toThrow(/getWorkloadAccessTokenForUserId/);
  });

  it('fail-closed: per-user exchange returns no workloadAccessToken → throws', async () => {
    const oauthOnly = fakeClient({ accessToken: 'tok' });
    const client: AgentCoreIdentityClientLike = {
      getResourceOauth2Token: oauthOnly.client.getResourceOauth2Token,
      getWorkloadAccessTokenForUserId: () => Promise.resolve({}),
    };
    await expect(
      agentCoreIdentity({ _client: client, workloadName: 'my-agent' }).getCredential({
        service: 's',
        mode: 'user',
        identity: { principal: 'alice' },
      }),
    ).rejects.toThrow(/no workloadAccessToken/);
  });

  it('END-TO-END: agent.run({ identity }) → declare-and-push threads it → AgentCore receives userId', async () => {
    const { client, oauthCalls, workloadCalls } = fakeWorkloadClient({ accessToken: 'e2e-tok' });
    let applied = '';
    const tool = defineTool({
      name: 'list_drive',
      description: 'list drive files',
      inputSchema: { type: 'object', properties: {} },
      needs: { credential: 'google', mode: 'user', scopes: ['drive'] },
      execute: async (_args, ctx) => {
        applied = ctx.credential ? ctx.credential.toHeaders().authorization! : '(none)';
        return 'files: 3';
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { content: 'listing', toolCalls: [{ id: 'c1', name: 'list_drive', args: {} }] },
          { content: 'You have 3 files.', toolCalls: [] },
        ],
      }),
      model: 'mock',
      maxIterations: 3,
      credentials: agentCoreIdentity({ _client: client, workloadName: 'my-agent' }),
    })
      .tools([tool])
      .build();

    await agent.run({
      message: 'list my files',
      identity: { tenant: 'acme', principal: 'alice', conversationId: 'conv-1' },
    });

    // runIdentity flowed: toolCalls → req.identity → per-user workload token → vend.
    expect(workloadCalls).toEqual([{ workloadName: 'my-agent', userId: 'alice' }]);
    expect(oauthCalls[0]!.workloadIdentityToken).toBe('user-scoped-token');
    expect(applied).toBe('Bearer e2e-tok');
  });
});

// ─── Property ────────────────────────────────────────────────────────
describe('identity — Property', () => {
  it('staticTokens issues the configured token verbatim for any service id', async () => {
    const services = ['a', 'GitHub', 'svc.with.dots', 'x-y_z', '🦄', 'a'.repeat(200)];
    for (const s of services) {
      const r = await staticTokens({ [s]: `tok::${s}` }).getCredential({ service: s });
      expect(isCredentialIssued(r) && r.credential.toHeaders().authorization).toBe(
        `Bearer tok::${s}`,
      );
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
  it('accidental JSON.stringify of a credential never emits the raw secret', () => {
    // Defence in depth: secret fields are non-enumerable, so a tool that
    // accidentally returns/logs ctx.credential serializes WITHOUT the secret.
    expect(JSON.stringify(bearer('SECRET_TOK'))).toBe('{"kind":"bearer"}');
    expect(JSON.stringify(apiKey('SECRET_KEY'))).toBe('{"kind":"apiKey","headerName":"x-api-key"}');
    expect(JSON.stringify(basic('u', 'SECRET_PW'))).toBe('{"kind":"basic","username":"u"}');
    expect(JSON.stringify(headers({ authorization: 'Bearer SECRET' }))).toBe('{"kind":"headers"}');
    // …while direct reads and the applicator still work:
    expect(bearer('SECRET_TOK').token).toBe('SECRET_TOK');
    expect(headers({ 'x-a': '1' }).toHeaders()).toEqual({ 'x-a': '1' });
  });

  it('a vended credential used locally in a tool never reaches the snapshot or narrative', async () => {
    const SECRET = 'ghp_super_secret_value_should_never_be_traced_9876543210';
    const credentials = staticTokens({ github: SECRET });
    const tool = defineTool({
      name: 'check',
      description: 'Use a credential locally; return only a non-secret result.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const r = await credentials.getCredential({ service: 'github' });
        // apply locally; return ONLY a derived, non-secret value
        const applied = isCredentialIssued(r) ? Object.keys(r.credential.toHeaders()).length : 0;
        return `checked (${applied} header set)`;
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
    expect(snapshot).not.toContain(SECRET);
    expect(narrative).not.toContain(SECRET);
    expect(snapshot + narrative).toContain('header set'); // proves the tool ran + applied
  });
});

// ─── Performance ─────────────────────────────────────────────────────
describe('identity — Performance', () => {
  it('staticTokens.getCredential is O(1) — 2000 calls finish well under budget', async () => {
    const p = staticTokens({ s: 'tok' });
    const start = Date.now();
    for (let i = 0; i < 2000; i++) await p.getCredential({ service: 's' });
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

// ─── Load ────────────────────────────────────────────────────────────
describe('identity — Load', () => {
  it('resolves 500 concurrent getCredential calls correctly', async () => {
    const p = staticTokens({ a: 'TA', b: 'TB' });
    const reqs = Array.from({ length: 500 }, (_, i) => (i % 2 === 0 ? 'a' : 'b'));
    const results = await Promise.all(reqs.map((service) => p.getCredential({ service })));
    results.forEach((r, i) => {
      expect(isCredentialIssued(r) && r.credential.toHeaders().authorization).toBe(
        `Bearer ${reqs[i] === 'a' ? 'TA' : 'TB'}`,
      );
    });
  });
});
