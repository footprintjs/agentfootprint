/**
 * agentCoreIdentity — the SDK shim, which nobody had ever run (9.4.0).
 *
 * Through 9.3.0 this adapter built a `BedrockAgentCoreClient` and then called
 * `client.getResourceOauth2Token(...)` as a METHOD. A bare `@aws-sdk/client-*`
 * Client has exactly two prototype methods, `send` and `destroy`; the
 * per-operation shortcuts live on the AGGREGATED client (`BedrockAgentCore`),
 * a different class. So the documented path — `agentCoreIdentity({ region })`
 * with no injected client — threw on its first call, 100% of the time, with a
 * message telling the operator to check their SDK version.
 *
 * It shipped because every test in the suite injected `_client`, which replaces
 * the entire mapping. The sibling memory adapter in this same package had the
 * `send(new Command(...))` form right all along.
 *
 * This file exercises the SHIM: the `_sdk` seam, so the real construction path
 * runs against a fake module. Nothing here reaches AWS. Command NAMES are
 * pinned separately and systemically in test/adapters/aws/.
 */

import { describe, expect, it } from 'vitest';

import {
  agentCoreIdentity,
  type BedrockAgentCoreIdentitySdkModule,
} from '../../src/adapters/identity/agentcore.js';
import { isCredentialIssued } from '../../src/identity/types.js';

interface Sent {
  readonly command: string;
  readonly input: Record<string, unknown>;
}

/** A fake `@aws-sdk/client-bedrock-agentcore`, command-based like the real one. */
function fakeSdk(answers: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
  const command = (name: string) =>
    class {
      readonly __command = name;
      readonly __input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.__input = input;
      }
    } as unknown as new (input: unknown) => unknown;

  const module: BedrockAgentCoreIdentitySdkModule = {
    BedrockAgentCoreClient: class {
      constructor(readonly config: { region?: string } = {}) {
        constructed.push(config);
      }
      async send(cmd: unknown): Promise<unknown> {
        const c = cmd as { __command: string; __input: Record<string, unknown> };
        sent.push({ command: c.__command, input: c.__input });
        return answers[c.__command] ?? {};
      }
    } as unknown as BedrockAgentCoreIdentitySdkModule['BedrockAgentCoreClient'],
    GetResourceOauth2TokenCommand: command('GetResourceOauth2TokenCommand'),
    GetWorkloadAccessTokenForUserIdCommand: command('GetWorkloadAccessTokenForUserIdCommand'),
    GetWorkloadAccessTokenForJWTCommand: command('GetWorkloadAccessTokenForJWTCommand'),
  };
  const constructed: { region?: string }[] = [];
  return { module, sent, constructed };
}

// ── unit — the command form ─────────────────────────────────────────

describe('agentCoreIdentity — the SDK shim', () => {
  it('vends through send(new GetResourceOauth2TokenCommand(...)), not a method on the client', async () => {
    const { module, sent } = fakeSdk({
      GetResourceOauth2TokenCommand: { accessToken: 'tok-1' },
    });
    const result = await agentCoreIdentity({
      region: 'us-west-2',
      workloadIdentityToken: 'wit',
      _sdk: module,
    }).getCredential({ service: 'github', scopes: ['repo'] });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.command).toBe('GetResourceOauth2TokenCommand');
    expect(sent[0]?.input).toMatchObject({
      resourceCredentialProviderName: 'github',
      scopes: ['repo'],
      oauth2Flow: 'M2M',
      forceAuthentication: false,
      workloadIdentityToken: 'wit',
    });
    expect(result).toMatchObject({ status: 'issued' });
  });

  it("mode 'user' asks for USER_FEDERATION, mode 'machine' for M2M", async () => {
    for (const [mode, flow] of [
      ['user', 'USER_FEDERATION'],
      ['machine', 'M2M'],
    ] as const) {
      const { module, sent } = fakeSdk({ GetResourceOauth2TokenCommand: { accessToken: 't' } });
      await agentCoreIdentity({ workloadIdentityToken: 'wit', _sdk: module }).getCredential({
        service: 's',
        mode,
      });
      expect(sent[0]?.input['oauth2Flow']).toBe(flow);
    }
  });

  it('carries the region onto the client it builds', async () => {
    const { module, constructed } = fakeSdk({
      GetResourceOauth2TokenCommand: { accessToken: 't' },
    });
    await agentCoreIdentity({
      region: 'eu-west-1',
      workloadIdentityToken: 'wit',
      _sdk: module,
    }).getCredential({ service: 's' });
    expect(constructed[0]).toEqual({ region: 'eu-west-1' });
  });
});

// ── boundary — the wire's field names are not this adapter's ────────

describe('agentCoreIdentity — reading the response the service really sends', () => {
  it('a consent round-trip reports sessionUri as the sessionId', async () => {
    const { module } = fakeSdk({
      GetResourceOauth2TokenCommand: {
        authorizationUrl: 'https://consent.example/authorize',
        // The service calls it `sessionUri`. Reading `sessionId` off this
        // response — which is what 9.3.0 did — yields undefined every time,
        // and the consumer got an empty string on every consent flow.
        sessionUri: 'session-abc',
      },
    });
    const result = await agentCoreIdentity({
      workloadIdentityToken: 'wit',
      _sdk: module,
    }).getCredential({ service: 'github', mode: 'user' });
    expect(result).toEqual({
      status: 'authorization-required',
      authorizationUrl: 'https://consent.example/authorize',
      sessionId: 'session-abc',
    });
  });

  it('reports no expiry, because GetResourceOauth2Token does not carry one', async () => {
    const { module } = fakeSdk({ GetResourceOauth2TokenCommand: { accessToken: 't' } });
    const result = await agentCoreIdentity({
      workloadIdentityToken: 'wit',
      _sdk: module,
    }).getCredential({ service: 's' });
    expect(result).not.toHaveProperty('expiresAt');
  });
});

// ── per-user workload scoping, through the real command path ────────

describe('agentCoreIdentity — per-user workload scoping via the shim', () => {
  it('exchanges (workloadName, userId) first, then vends with that token', async () => {
    const { module, sent } = fakeSdk({
      GetWorkloadAccessTokenForUserIdCommand: { workloadAccessToken: 'user-scoped' },
      GetResourceOauth2TokenCommand: { accessToken: 't' },
    });
    await agentCoreIdentity({
      workloadName: 'my-agent',
      workloadIdentityToken: 'the-static-one',
      _sdk: module,
    }).getCredential({ service: 's', mode: 'user', identity: { principal: 'ada' } });

    expect(sent.map((s) => s.command)).toEqual([
      'GetWorkloadAccessTokenForUserIdCommand',
      'GetResourceOauth2TokenCommand',
    ]);
    expect(sent[0]?.input).toEqual({ workloadName: 'my-agent', userId: 'ada' });
    // The per-user token WINS over the static one — that is the whole point of
    // configuring `workloadName`.
    expect(sent[1]?.input['workloadIdentityToken']).toBe('user-scoped');
  });

  it('refuses rather than silently vending at workload level when the exchange returns nothing', async () => {
    const { module } = fakeSdk({
      GetWorkloadAccessTokenForUserIdCommand: {},
      GetResourceOauth2TokenCommand: { accessToken: 't' },
    });
    await expect(
      agentCoreIdentity({ workloadName: 'my-agent', _sdk: module }).getCredential({
        service: 's',
        mode: 'user',
        identity: { principal: 'ada' },
      }),
    ).rejects.toThrow(/workloadAccessToken/);
  });
});

// ── the JWT exchange: proof rather than assertion (9.12.0) ──────────

describe('agentCoreIdentity — exchanging the user’s own JWT', () => {
  it('exchanges (workloadName, userToken) first, then vends with what came back', async () => {
    const { module, sent } = fakeSdk({
      GetWorkloadAccessTokenForJWTCommand: { workloadAccessToken: 'workload-and-user' },
      GetResourceOauth2TokenCommand: { accessToken: 't' },
    });
    const result = await agentCoreIdentity({
      workloadName: 'my-agent',
      workloadIdentityToken: 'the-static-one',
      _sdk: module,
    }).getCredential({ service: 's', mode: 'user', userToken: 'jwt.from.the.idp' });

    expect(sent.map((s) => s.command)).toEqual([
      'GetWorkloadAccessTokenForJWTCommand',
      'GetResourceOauth2TokenCommand',
    ]);
    // `userToken` is the SDK's own field name — no rename between the port and
    // the wire, which is one fewer place for a shape to drift.
    expect(sent[0]?.input).toEqual({ workloadName: 'my-agent', userToken: 'jwt.from.the.idp' });
    expect(sent[1]?.input['workloadIdentityToken']).toBe('workload-and-user');
    // Nothing else about vending changed: the same credential, through the same
    // machinery, out of the same result branch.
    expect(result).toMatchObject({ status: 'issued' });
    expect(isCredentialIssued(result) && result.credential.toHeaders()).toEqual({
      authorization: 'Bearer t',
    });
  });

  it('the JWT wins over the userId path — proof beats an assertion about the same person', async () => {
    const { module, sent } = fakeSdk({
      GetWorkloadAccessTokenForJWTCommand: { workloadAccessToken: 'from-jwt' },
      GetWorkloadAccessTokenForUserIdCommand: { workloadAccessToken: 'from-assertion' },
      GetResourceOauth2TokenCommand: { accessToken: 't' },
    });
    await agentCoreIdentity({ workloadName: 'my-agent', _sdk: module }).getCredential({
      service: 's',
      mode: 'user',
      identity: { principal: 'ada' },
      userToken: 'jwt',
    });
    expect(sent.map((s) => s.command)).not.toContain('GetWorkloadAccessTokenForUserIdCommand');
    expect(sent[1]?.input['workloadIdentityToken']).toBe('from-jwt');
  });

  it('a request without one is untouched — the mode rides the REQUEST, not the provider', async () => {
    const provider = agentCoreIdentity({ workloadName: 'my-agent', workloadIdentityToken: 'wit' });
    const withJwt = fakeSdk({
      GetWorkloadAccessTokenForJWTCommand: { workloadAccessToken: 'exchanged' },
      GetResourceOauth2TokenCommand: { accessToken: 't' },
    });
    const without = fakeSdk({ GetResourceOauth2TokenCommand: { accessToken: 't' } });

    // One provider, two requests, two different paths — because the token
    // belongs to the caller, not to the configuration.
    await agentCoreIdentity({ ...jwtOptions(withJwt.module) }).getCredential({
      service: 's',
      mode: 'user',
      userToken: 'jwt',
    });
    await agentCoreIdentity({ ...jwtOptions(without.module) }).getCredential({
      service: 's',
      mode: 'machine',
    });

    expect(withJwt.sent.map((s) => s.command)).toContain('GetWorkloadAccessTokenForJWTCommand');
    expect(without.sent.map((s) => s.command)).toEqual(['GetResourceOauth2TokenCommand']);
    expect(without.sent[0]?.input['workloadIdentityToken']).toBe('wit');
    expect(provider.id).toBe('agentcore-identity');
  });

  it('`requireUserToken` refuses a delegated request with no JWT — and never touches M2M', async () => {
    const { module, sent } = fakeSdk({ GetResourceOauth2TokenCommand: { accessToken: 't' } });
    const provider = agentCoreIdentity({
      workloadName: 'my-agent',
      workloadIdentityToken: 'wit',
      requireUserToken: true,
      _sdk: module,
    });

    const failure = await provider.getCredential({ service: 'github', mode: 'user' }).then(
      () => '',
      (err: Error) => err.message,
    );
    expect(failure).toContain('requireUserToken');
    expect(failure).toContain('userToken');
    expect(failure).toContain("'github'");
    // A refusal is not a call.
    expect(sent).toEqual([]);

    // M2M has no user to prove, so the flag has nothing to say about it.
    await expect(
      provider.getCredential({ service: 'github', mode: 'machine' }),
    ).resolves.toMatchObject({ status: 'issued' });
  });

  it('refuses a JWT on a machine request rather than ignoring it', async () => {
    const { module, sent } = fakeSdk({ GetResourceOauth2TokenCommand: { accessToken: 't' } });
    const failure = await agentCoreIdentity({ workloadName: 'w', _sdk: module })
      .getCredential({ service: 's', mode: 'machine', userToken: 'jwt' })
      .then(
        () => '',
        (err: Error) => err.message,
      );
    expect(failure).toMatch(/M2M/);
    expect(failure).toContain("mode: 'user'");
    expect(sent).toEqual([]);
  });

  it('refuses a JWT with no `workloadName` to exchange it against', async () => {
    const { module, sent } = fakeSdk({ GetResourceOauth2TokenCommand: { accessToken: 't' } });
    const failure = await agentCoreIdentity({ workloadIdentityToken: 'wit', _sdk: module })
      .getCredential({ service: 's', mode: 'user', userToken: 'jwt' })
      .then(
        () => '',
        (err: Error) => err.message,
      );
    expect(failure).toContain('workloadName');
    // The whole point: it did NOT quietly vend at workload level.
    expect(sent).toEqual([]);
  });

  it('describes a malformed exchange response by its SHAPE, never its content', async () => {
    const { module } = fakeSdk({
      // What a shape drift looks like from here: fields came back, none of them
      // the one this adapter needs — and one of them is a token.
      GetWorkloadAccessTokenForJWTCommand: {
        accessToken: 'A-TOKEN-THAT-MUST-NOT-BE-PRINTED',
        expiresIn: 3600,
      },
      GetResourceOauth2TokenCommand: { accessToken: 't' },
    });
    const failure = await agentCoreIdentity({ workloadName: 'w', _sdk: module })
      .getCredential({ service: 's', mode: 'user', userToken: 'jwt' })
      .then(
        () => '',
        (err: Error) => err.message,
      );
    expect(failure).toContain('GetWorkloadAccessTokenForJWT');
    expect(failure).toContain('workloadAccessToken');
    // The shape: how many fields, and what they are called.
    expect(failure).toContain('2 field(s)');
    expect(failure).toContain('accessToken, expiresIn');
    // The content: never.
    expect(failure).not.toContain('A-TOKEN-THAT-MUST-NOT-BE-PRINTED');
    expect(failure).not.toContain('3600');
  });

  it('an injected `_client` that cannot exchange is named, not worked around', async () => {
    const failure = await agentCoreIdentity({
      workloadName: 'w',
      _client: { getResourceOauth2Token: async () => ({ accessToken: 't' }) },
    })
      .getCredential({ service: 's', mode: 'user', userToken: 'jwt' })
      .then(
        () => '',
        (err: Error) => err.message,
      );
    expect(failure).toContain('getWorkloadAccessTokenForJWT');
  });
});

/** The same provider options twice over, with a different fake module each. */
function jwtOptions(module: BedrockAgentCoreIdentitySdkModule) {
  return { workloadName: 'my-agent', workloadIdentityToken: 'wit', _sdk: module } as const;
}

// ── refusals — each one names the thing to fix ──────────────────────

describe('agentCoreIdentity — refusals', () => {
  it('names the missing SDK command instead of failing obscurely', async () => {
    const { module } = fakeSdk();
    const stripped: BedrockAgentCoreIdentitySdkModule = {
      BedrockAgentCoreClient: module.BedrockAgentCoreClient!,
    };
    await expect(
      agentCoreIdentity({ workloadIdentityToken: 'wit', _sdk: stripped }).getCredential({
        service: 's',
      }),
    ).rejects.toThrow(/GetResourceOauth2TokenCommand/);
  });

  it('says to update the SDK when the client class itself is absent', async () => {
    await expect(
      agentCoreIdentity({ workloadIdentityToken: 'wit', _sdk: {} }).getCredential({ service: 's' }),
    ).rejects.toThrow(/BedrockAgentCoreClient/);
  });

  it('refuses a call with no workload identity token, naming both ways to supply one', async () => {
    const { module, sent } = fakeSdk({ GetResourceOauth2TokenCommand: { accessToken: 't' } });
    // `workloadIdentityToken` is REQUIRED on GetResourceOauth2TokenRequest.
    // Sending without it buys an opaque ValidationException from AWS; refusing
    // here names `workloadName` and `workloadIdentityToken` instead.
    const failure = await agentCoreIdentity({ region: 'us-east-1', _sdk: module })
      .getCredential({ service: 's' })
      .then(
        () => '',
        (err: Error) => err.message,
      );
    expect(failure).toMatch(/workload identity token/i);
    expect(failure).toContain('workloadName');
    expect(failure).toContain('workloadIdentityToken');
    // And nothing was sent — a refusal is not a call.
    expect(sent).toEqual([]);
  });

  it('constructing one touches no SDK at all', () => {
    // No `_client`, no `_sdk`, and the peer dep is not installed in this repo:
    // an eager require would throw on this line.
    expect(() => agentCoreIdentity({ region: 'us-east-1' })).not.toThrow();
  });

  it('names the missing peer dependency when there is no SDK and no client', async () => {
    await expect(
      agentCoreIdentity({ region: 'us-east-1', workloadIdentityToken: 'wit' }).getCredential({
        service: 's',
      }),
    ).rejects.toThrow(/@aws-sdk\/client-bedrock-agentcore/);
  });
});

// ── the `_client` seam is untouched ─────────────────────────────────

describe('agentCoreIdentity — an injected client still owns its own mapping', () => {
  it('bypasses the shim entirely, including the workload-token requirement', async () => {
    let asked = 0;
    const result = await agentCoreIdentity({
      _client: {
        getResourceOauth2Token: async () => {
          asked++;
          // A custom integration may know an expiry from somewhere else; the
          // shim's field mapping is not imposed on it.
          return { accessToken: 'from-my-own-vault', expiresAt: 1234 };
        },
      },
    }).getCredential({ service: 's' });

    expect(asked).toBe(1);
    expect(result).toMatchObject({ status: 'issued', expiresAt: 1234 });
  });
});
