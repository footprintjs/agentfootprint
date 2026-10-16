/**
 * requestCredentials + requestContext — a credential fed from the incoming
 * request, sealed per run, failing closed by name.
 *
 * Threat model: the model, tool input and message text are untrusted; the
 * sealed request must not be readable through any copy of it, and a provider
 * refusal must name the service and the secret's NAME, never its value.
 */

import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { Agent, Sequence, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  apiKey,
  asApiKey,
  asBearer,
  decodedWith,
  isRequestContext,
  RequestCredentialError,
  requestContext,
  requestCredentials,
  staticTokens,
} from '../../src/doors/security.js';
import { bindRequest } from '../../src/identity/requestContext.js';

const TOKEN = 'req-token-7f3a9c1e5b2d';

describe('requestContext — the sealed handle', () => {
  it('no copy of the handle carries a value', () => {
    const request = requestContext({ secrets: { mcpToken: TOKEN } });
    expect(JSON.stringify({ request })).toBe('{"request":"[request context]"}');
    expect(Object.keys(request)).toEqual([]);
    expect(JSON.stringify(structuredClone(request))).not.toContain(TOKEN);
    expect(JSON.stringify({ ...request })).toBe('{}');
    expect(inspect(request, { depth: 5, showHidden: true })).not.toContain(TOKEN);
    expect(String(request)).toBe('[request context]');
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('is recognised only when requestContext built it', () => {
    expect(isRequestContext(requestContext({ secrets: {} }))).toBe(true);
    expect(isRequestContext({ kind: 'request-context' })).toBe(false);
    expect(isRequestContext(structuredClone(requestContext({ secrets: { a: 'b' } })))).toBe(false);
  });

  it.each([
    ['no secrets', {}],
    ['an array', { secrets: ['x'] }],
    ['an empty value', { secrets: { a: '' } }],
    ['a number', { secrets: { a: 7 } }],
  ])('refuses %s, naming the secret and never a value', (_, options) => {
    expect(() => requestContext(options as never)).toThrow(TypeError);
  });

  it('a malformed secret is named; its value is not quoted', () => {
    try {
      requestContext({ secrets: { mcpToken: 42 as unknown as string } });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("'mcpToken'");
      expect((err as Error).message).not.toContain('42');
    }
  });
});

describe('requestCredentials — the provider', () => {
  const provider = requestCredentials({
    services: {
      crm: 'crmToken',
      billing: { secret: 'billingKey', as: asApiKey('x-billing-key') },
      vault: { secret: 'sealed', as: decodedWith((raw) => raw.split('').reverse().join('')) },
      broken: {
        secret: 'sealed',
        as: decodedWith(() => Promise.reject(new Error(`bad ${TOKEN}`))),
      },
    },
  });

  it('issues the request’s own value through the strategy', async () => {
    const request = requestContext({
      secrets: { crmToken: TOKEN, billingKey: 'bk-1', sealed: 'cba' },
    });
    const crm = await provider.getCredential({ service: 'crm', request });
    expect(crm.status === 'issued' && crm.credential.toHeaders()).toEqual({
      authorization: `Bearer ${TOKEN}`,
    });
    const billing = await provider.getCredential({ service: 'billing', request });
    expect(billing.status === 'issued' && billing.credential.toHeaders()).toEqual({
      'x-billing-key': 'bk-1',
    });
    const vault = await provider.getCredential({ service: 'vault', request });
    expect(vault.status === 'issued' && vault.credential.toHeaders()).toEqual({
      authorization: 'Bearer abc',
    });
  });

  it.each([
    ['no-request', 'crm', undefined],
    ['missing', 'crm', { billingKey: 'x' }],
    ['unknown-service', 'github', { crmToken: TOKEN }],
    ['undecodable', 'broken', { sealed: TOKEN }],
  ] as const)('refuses %s by name, never quoting a value', async (reason, service, secrets) => {
    const request = secrets === undefined ? undefined : requestContext({ secrets });
    const err = await provider.getCredential({ service, ...(request && { request }) }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RequestCredentialError);
    expect((err as RequestCredentialError).reason).toBe(reason);
    expect((err as RequestCredentialError).service).toBe(service);
    expect((err as Error).message).toContain(`'${service}'`);
    expect((err as Error).message).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it('a strategy that returns no credential is undecodable', async () => {
    const p = requestCredentials({
      services: { x: { secret: 's', as: () => ({ token: 'nope' } as never) } },
    });
    await expect(
      p.getCredential({ service: 'x', request: requestContext({ secrets: { s: TOKEN } }) }),
    ).rejects.toMatchObject({ reason: 'undecodable' });
  });

  it.each([
    ['no services', { services: {} }],
    ['an empty secret name', { services: { crm: '' } }],
    ['a strategy that is not a function', { services: { crm: { secret: 'x', as: 'bearer' } } }],
  ])('refuses %s at boot', (_, options) => {
    expect(() => requestCredentials(options as never)).toThrow(TypeError);
  });

  it('asBearer is the default strategy', async () => {
    expect(asBearer()('t').toHeaders()).toEqual({ authorization: 'Bearer t' });
    expect(asApiKey()('k').toHeaders()).toEqual(apiKey('k').toHeaders());
  });
});

describe('bindRequest — the framework decides which request a call carries', () => {
  const spyProvider = (seen: unknown[]) => ({
    id: 'spy',
    getCredential: async (req: { request?: unknown }) => {
      seen.push(req.request);
      return staticTokens({ s: 'x' }).getCredential({ service: 's' });
    },
  });

  it('replaces a request the call presents with the run’s own, or with none', async () => {
    const seen: unknown[] = [];
    const mine = requestContext({ secrets: { a: '1' } });
    const theirs = requestContext({ secrets: { a: '2' } });
    await bindRequest(spyProvider(seen), mine, 's').getCredential({
      service: 's',
      request: theirs,
    });
    await bindRequest(spyProvider(seen), undefined, 's').getCredential({
      service: 's',
      request: theirs,
    });
    expect(seen[0]).toBe(mine);
    expect(seen[1]).toBeUndefined();
    expect(bindRequest(spyProvider(seen), mine, 's').id).toBe('spy');
  });

  it('carries the request only for the service the tool declares', async () => {
    const seen: unknown[] = [];
    const mine = requestContext({ secrets: { a: '1' } });
    await bindRequest(spyProvider(seen), mine, 'crm').getCredential({ service: 'billing' });
    await bindRequest(spyProvider(seen), mine, undefined).getCredential({ service: 'crm' });
    expect(seen).toEqual([undefined, undefined]);
  });
});

describe('the pull path cannot reach a request credential the tool did not declare', () => {
  it.each([
    ['a tool with no needs', undefined],
    ['a tool that needs another service', { credential: 'billing' }],
  ])('%s is refused for crm', async (_, needs) => {
    let outcome = '';
    const tool = defineTool({
      name: 'sneaky',
      description: 'pulls a credential',
      inputSchema: { type: 'object', properties: {} },
      ...(needs !== undefined && { needs }),
      execute: async (_args, ctx) => {
        outcome = await ctx.credentials
          .getCredential({ service: 'crm' })
          .then((r) => (r.status === 'issued' ? r.credential.toHeaders().authorization! : 'x'))
          .catch((e: Error) => e.message);
        return 'ok';
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'c1', name: 'sneaky', args: {} }] }, { content: 'done' }],
      }),
      model: 'mock',
      maxIterations: 3,
      credentials: requestCredentials({ services: { crm: 'crmToken', billing: 'billingKey' } }),
    })
      .tools([tool])
      .build();
    await agent.run(
      { message: 'go' },
      { request: requestContext({ secrets: { crmToken: TOKEN, billingKey: 'bk' } }) },
    );
    expect(outcome).toMatch(/carries none/);
    expect(outcome).not.toContain(TOKEN);
  });
});

describe('the run doors refuse a request requestContext did not build', () => {
  const tool = defineTool({
    name: 'noop',
    description: 'noop',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => 'ok',
  });

  it('Agent.run', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'hi' }), model: 'mock' })
      .tools([tool])
      .build();
    await expect(
      agent.run({ message: 'go' }, { request: { secrets: { a: TOKEN } } as never }),
    ).rejects.toThrow(/Agent\.run: `request` must be built by requestContext/);
  });

  it('Sequence.run', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'hi' }), model: 'mock' }).build();
    const flow = Sequence.create({ id: 's' }).step('a', agent).build();
    await expect(flow.run({ message: 'go' }, { request: { a: TOKEN } as never })).rejects.toThrow(
      /Sequence\.run: `request` must be built by requestContext/,
    );
  });
});
