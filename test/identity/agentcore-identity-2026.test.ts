/**
 * agentCoreIdentity — the three operations AgentCore Identity grew after 9.4.0.
 *
 * Each is a different KIND of gap, and the tests are shaped accordingly:
 *
 *   • `ON_BEHALF_OF_TOKEN_EXCHANGE` — a third value on a field we already sent.
 *     What matters is that it is chosen deliberately (`userFlow`) and never for
 *     a machine request, which has no user to act for.
 *   • `GetResourceApiKey` — a different operation AND a different credential
 *     kind, so the test follows it all the way out to the header a tool sends.
 *   • `CompleteResourceTokenAuth` — a handshake that happens in somebody else's
 *     process, which is why it is a function rather than a provider method, and
 *     why naming the person twice (or not at all) is refused before any call.
 *
 * The command NAMES and request SHAPES asserted here were verified against a
 * real install of `@aws-sdk/client-bedrock-agentcore` 3.1118.0 — the 9.4.0 law
 * that no AWS adapter ships on a remembered API. Nothing here reaches AWS.
 */

import { describe, expect, it } from 'vitest';

import {
  agentCoreIdentity,
  completeAgentCoreAuthorization,
  type AgentCoreIdentityClientLike,
} from '../../src/adapters/identity/agentcore.js';
import { isCredentialIssued } from '../../src/identity/types.js';

/** Records every call, answering whatever the test scripted. */
function spyClient(answers: {
  oauth?: { accessToken?: string; authorizationUrl?: string; sessionId?: string };
  apiKey?: { apiKey?: string };
}): {
  client: AgentCoreIdentityClientLike;
  oauthCalls: Record<string, unknown>[];
  apiKeyCalls: Record<string, unknown>[];
  completions: Record<string, unknown>[];
} {
  const oauthCalls: Record<string, unknown>[] = [];
  const apiKeyCalls: Record<string, unknown>[] = [];
  const completions: Record<string, unknown>[] = [];
  return {
    oauthCalls,
    apiKeyCalls,
    completions,
    client: {
      async getResourceOauth2Token(input) {
        oauthCalls.push({ ...input });
        return answers.oauth ?? { accessToken: 'tok' };
      },
      async getResourceApiKey(input) {
        apiKeyCalls.push({ ...input });
        return answers.apiKey ?? { apiKey: 'key-1' };
      },
      async completeResourceTokenAuth(input) {
        completions.push({ ...input });
      },
    },
  };
}

// ─── on-behalf-of exchange ───────────────────────────────────────────

describe('userFlow selects how a person’s token is obtained', () => {
  it('defaults to consent — the flow that can return an authorization URL', async () => {
    const { client, oauthCalls } = spyClient({});
    await agentCoreIdentity({ workloadIdentityToken: 'wit', _client: client }).getCredential({
      service: 'github',
      mode: 'user',
    });
    expect(oauthCalls[0]?.oauth2Flow).toBe('USER_FEDERATION');
  });

  it("'exchange' trades the person's login with no consent screen", async () => {
    const { client, oauthCalls } = spyClient({});
    await agentCoreIdentity({
      workloadIdentityToken: 'wit',
      userFlow: 'exchange',
      _client: client,
    }).getCredential({ service: 'github', mode: 'user' });
    expect(oauthCalls[0]?.oauth2Flow).toBe('ON_BEHALF_OF_TOKEN_EXCHANGE');
  });

  it('never applies to a machine request — M2M has no user to act for', async () => {
    const { client, oauthCalls } = spyClient({});
    const provider = agentCoreIdentity({
      workloadIdentityToken: 'wit',
      userFlow: 'exchange',
      _client: client,
    });
    await provider.getCredential({ service: 'github', mode: 'machine' });
    await provider.getCredential({ service: 'github' }); // mode defaults to machine
    expect(oauthCalls.map((c) => c.oauth2Flow)).toEqual(['M2M', 'M2M']);
  });
});

// ─── API-key vending ─────────────────────────────────────────────────

describe('apiKeyServices vend a key, not a bearer token', () => {
  it('routes a listed service to GetResourceApiKey and never to OAuth', async () => {
    const { client, apiKeyCalls, oauthCalls } = spyClient({ apiKey: { apiKey: 'sk-live-1' } });
    const result = await agentCoreIdentity({
      workloadIdentityToken: 'wit',
      apiKeyServices: ['stripe'],
      _client: client,
    }).getCredential({ service: 'stripe' });

    expect(apiKeyCalls).toHaveLength(1);
    expect(apiKeyCalls[0]).toEqual({
      resourceCredentialProviderName: 'stripe',
      workloadIdentityToken: 'wit',
    });
    expect(oauthCalls).toHaveLength(0);

    // All the way out to the header a tool would actually send.
    expect(isCredentialIssued(result)).toBe(true);
    if (isCredentialIssued(result)) {
      expect(result.credential.toHeaders()).toEqual({ 'x-api-key': 'sk-live-1' });
    }
  });

  it('honours a custom header name', async () => {
    const { client } = spyClient({ apiKey: { apiKey: 'k' } });
    const result = await agentCoreIdentity({
      workloadIdentityToken: 'wit',
      apiKeyServices: ['acme'],
      apiKeyHeader: 'authorization-token',
      _client: client,
    }).getCredential({ service: 'acme' });
    if (isCredentialIssued(result)) {
      expect(result.credential.toHeaders()).toEqual({ 'authorization-token': 'k' });
    }
  });

  it('leaves every unlisted service on the OAuth path', async () => {
    const { client, apiKeyCalls, oauthCalls } = spyClient({});
    await agentCoreIdentity({
      workloadIdentityToken: 'wit',
      apiKeyServices: ['stripe'],
      _client: client,
    }).getCredential({ service: 'github' });
    expect(oauthCalls).toHaveLength(1);
    expect(apiKeyCalls).toHaveLength(0);
  });

  it('refuses by name when no workload token is available, rather than sending a bad call', async () => {
    const { client, apiKeyCalls } = spyClient({});
    await expect(
      agentCoreIdentity({ apiKeyServices: ['stripe'], _client: client }).getCredential({
        service: 'stripe',
      }),
    ).rejects.toThrow(/requires a workload identity token/);
    expect(apiKeyCalls).toHaveLength(0);
  });

  it('refuses a key the service did not return', async () => {
    const { client } = spyClient({ apiKey: {} });
    await expect(
      agentCoreIdentity({
        workloadIdentityToken: 'wit',
        apiKeyServices: ['stripe'],
        _client: client,
      }).getCredential({ service: 'stripe' }),
    ).rejects.toThrow(/returned no key/);
  });
});

// ─── the consent handshake ───────────────────────────────────────────

describe('completeAgentCoreAuthorization closes a 3LO round-trip', () => {
  it("passes the person's own JWT through as the user identifier", async () => {
    const { client, completions } = spyClient({});
    await completeAgentCoreAuthorization({
      sessionId: 'urn:ietf:params:oauth:request_uri:abc',
      userToken: 'the-users-jwt',
      _client: client,
    });
    expect(completions[0]).toEqual({
      sessionId: 'urn:ietf:params:oauth:request_uri:abc',
      userToken: 'the-users-jwt',
    });
  });

  it('accepts an asserted user id when no JWT is available', async () => {
    const { client, completions } = spyClient({});
    await completeAgentCoreAuthorization({ sessionId: 's-1', userId: 'u-7', _client: client });
    expect(completions[0]).toEqual({ sessionId: 's-1', userId: 'u-7' });
  });

  it('refuses naming the person twice — the wire field is a one-of', async () => {
    const { client, completions } = spyClient({});
    await expect(
      completeAgentCoreAuthorization({
        sessionId: 's-1',
        userId: 'u-7',
        userToken: 'jwt',
        _client: client,
      }),
    ).rejects.toThrow(/exactly one of/);
    expect(completions).toHaveLength(0);
  });

  it('refuses naming them not at all', async () => {
    const { client, completions } = spyClient({});
    await expect(
      completeAgentCoreAuthorization({ sessionId: 's-1', _client: client }),
    ).rejects.toThrow(/exactly one of/);
    expect(completions).toHaveLength(0);
  });

  it('refuses without the session it is completing', async () => {
    const { client } = spyClient({});
    await expect(
      completeAgentCoreAuthorization({ sessionId: '', userId: 'u', _client: client }),
    ).rejects.toThrow(/`sessionId` is required/);
  });
});

// ─── the round trip these three exist to make possible ───────────────

describe('consent, completed, then issued — the pause and its resume', () => {
  it('the same request that asked for consent issues a credential after it', async () => {
    // First vend: the vault has no grant, so the person must approve.
    let consented = false;
    const client: AgentCoreIdentityClientLike = {
      async getResourceOauth2Token() {
        return consented
          ? { accessToken: 'tok-after-consent' }
          : { authorizationUrl: 'https://consent.example/go', sessionId: 'sess-1' };
      },
      async completeResourceTokenAuth(input) {
        if (input.sessionId === 'sess-1') consented = true;
      },
    };
    const provider = agentCoreIdentity({ workloadIdentityToken: 'wit', _client: client });

    const first = await provider.getCredential({ service: 'github', mode: 'user' });
    expect(first.status).toBe('authorization-required');
    if (first.status !== 'authorization-required') throw new Error('unreachable');

    // …the person approves in their browser, and YOUR callback route calls this.
    await completeAgentCoreAuthorization({
      sessionId: first.sessionId,
      userId: 'u-7',
      _client: client,
    });

    // The retry is the resume: same request, now issued.
    const second = await provider.getCredential({ service: 'github', mode: 'user' });
    expect(isCredentialIssued(second)).toBe(true);
  });
});
