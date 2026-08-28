/**
 * foundry() — Microsoft Foundry provider.
 *
 * The ONE design fact under test: `foundry()` is a VENDOR FILE over
 * `openai()`'s machinery — every Foundry spelling (the project-endpoint
 * shape, the env names, the token audience, the `/openai/v1` derivation)
 * lives in that file, refusals open with `foundry:` and end with a `Fix:`
 * that names the exact option/env, and no message ever echoes a token.
 * Tests use the fake-client recorder pattern (AzureOpenAIProvider.test.ts),
 * so deployment routing, auth resolution and streaming are pinned without
 * the real SDK or network.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { foundry, foundryInferenceUrl } from '../../../src/adapters/llm/FoundryProvider.js';
import { AZURE_AI_SCOPE } from '../../../src/adapters/identity/azure.js';
import type { AccessTokenLike } from '../../../src/adapters/identity/azure.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

function fakeClient(recorder: { params: Array<{ model: string; stream?: boolean }> }) {
  return {
    chat: {
      completions: {
        create: vi.fn((params: { model: string; stream?: boolean }) => {
          recorder.params.push(params);
          if (params.stream) {
            return (async function* () {
              yield {
                id: 'fd1',
                model: params.model,
                choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
              };
              yield {
                id: 'fd1',
                model: params.model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 5, completion_tokens: 1 },
              };
            })();
          }
          return Promise.resolve({
            id: 'fd1',
            model: params.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'hi from foundry' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 1 },
          });
        }),
      },
    },
  };
}

const ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj-1';
const V1 = `${ENDPOINT}/openai/v1`;

const req = (model: string): LLMRequest => ({
  model,
  messages: [{ role: 'user', content: 'q' }],
});

/** A token nobody may ever see in an error message. */
const PLANTED_TOKEN = 'sk-entra-DO-NOT-LEAK-7b2a';

const access = (token: string): AccessTokenLike => ({
  token,
  expiresOnTimestamp: Date.now() + 3600_000,
});

// ─── Env harness ────────────────────────────────────────────────────

const VARS = ['FOUNDRY_PROJECT_ENDPOINT', 'AZURE_AI_MODEL_DEPLOYMENT_NAME', 'MODEL_NAME'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const v of VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

// ─── Routing (unit) ─────────────────────────────────────────────────

describe('foundry()', () => {
  it('names itself foundry', () => {
    const p = foundry({
      _client: fakeClient({ params: [] }),
      projectEndpoint: ENDPOINT,
      deployment: 'gpt-4o-128k',
    });
    expect(p.name).toBe('foundry');
  });

  it("routes the shorthand model 'foundry' to the configured deployment", async () => {
    const rec = { params: [] as Array<{ model: string }> };
    const p = foundry({ _client: fakeClient(rec), projectEndpoint: ENDPOINT, deployment: 'dep-a' });
    const res = await p.complete(req('foundry'));
    expect(rec.params[0]!.model).toBe('dep-a'); // deployment, not 'foundry'
    expect(res.content).toBe('hi from foundry');
    expect(res.usage).toEqual({ input: 5, output: 1 });
  });

  it('passes a concrete deployment id through (target multiple deployments)', async () => {
    const rec = { params: [] as Array<{ model: string }> };
    const p = foundry({
      _client: fakeClient(rec),
      projectEndpoint: ENDPOINT,
      deployment: 'default-dep',
    });
    await p.complete(req('another-deployment'));
    expect(rec.params[0]!.model).toBe('another-deployment');
  });

  it('streams (delegates to the openai streaming path) and routes the deployment', async () => {
    const rec = { params: [] as Array<{ model: string; stream?: boolean }> };
    const p = foundry({
      _client: fakeClient(rec),
      projectEndpoint: ENDPOINT,
      deployment: 'gpt-4o-128k',
    });
    let final: { content: string } | undefined;
    for await (const chunk of p.stream!(req('foundry'))) {
      if (chunk.done) final = chunk.response;
    }
    expect(rec.params[0]).toMatchObject({ model: 'gpt-4o-128k', stream: true });
    expect(final?.content).toBe('hi');
  });
});

// ─── Env fallbacks ──────────────────────────────────────────────────

describe('foundry() — env fallbacks', () => {
  it('reads FOUNDRY_PROJECT_ENDPOINT (the hosted-container injection) and AZURE_AI_MODEL_DEPLOYMENT_NAME', async () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = ENDPOINT;
    process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME = 'dep-from-azd';
    const rec = { params: [] as Array<{ model: string }> };
    const p = foundry({ _client: fakeClient(rec) });
    await p.complete(req('foundry'));
    expect(rec.params[0]!.model).toBe('dep-from-azd');
  });

  it('falls back to MODEL_NAME for the deployment when the azd name is absent', async () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = ENDPOINT;
    process.env.MODEL_NAME = 'dep-from-model-name';
    const rec = { params: [] as Array<{ model: string }> };
    const p = foundry({ _client: fakeClient(rec) });
    await p.complete(req('foundry'));
    expect(rec.params[0]!.model).toBe('dep-from-model-name');
  });
});

// ─── Refusal wording ────────────────────────────────────────────────

describe('foundry() — refusals name the fix', () => {
  it('a missing endpoint names FOUNDRY_PROJECT_ENDPOINT and shows the expected shape', () => {
    let thrown: Error | undefined;
    try {
      foundry({ _client: fakeClient({ params: [] }), deployment: 'd' });
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/^foundry: /);
    expect(thrown!.message).toContain('FOUNDRY_PROJECT_ENDPOINT');
    expect(thrown!.message).toContain('/api/projects/');
    expect(thrown!.message).toContain('Fix:');
  });

  it('a missing deployment names AZURE_AI_MODEL_DEPLOYMENT_NAME and MODEL_NAME', () => {
    let thrown: Error | undefined;
    try {
      foundry({ _client: fakeClient({ params: [] }), projectEndpoint: ENDPOINT });
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/^foundry: /);
    expect(thrown!.message).toContain('AZURE_AI_MODEL_DEPLOYMENT_NAME');
    expect(thrown!.message).toContain('MODEL_NAME');
    expect(thrown!.message).toContain('Fix:');
  });

  it('an http:// (non-loopback) endpoint is refused with the expected shape shown', () => {
    expect(() =>
      foundry({
        _client: fakeClient({ params: [] }),
        projectEndpoint: 'http://acct.services.ai.azure.com/api/projects/proj-1',
        deployment: 'd',
      }),
    ).toThrow(/https:\/\/\{account\}\.services\.ai\.azure\.com\/api\/projects\/\{project\}/);
  });

  it('an endpoint missing /api/projects/ is refused with the expected shape shown', () => {
    // A resource ROOT is a real Azure endpoint — for azureOpenai(), not here.
    expect(() =>
      foundry({
        _client: fakeClient({ params: [] }),
        projectEndpoint: 'https://acct.services.ai.azure.com',
        deployment: 'd',
      }),
    ).toThrow(/Expected: {2}https:\/\/\{account\}/);
  });

  it('credential AND apiKey together are refused by name, and no secret is echoed', () => {
    let thrown: Error | undefined;
    try {
      foundry({
        _client: fakeClient({ params: [] }),
        projectEndpoint: ENDPOINT,
        deployment: 'd',
        credential: { getToken: async () => access(PLANTED_TOKEN) },
        apiKey: 'sk-foundry-DO-NOT-LEAK-9c1d',
      });
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/^foundry: /);
    expect(thrown!.message).toContain('`credential`');
    expect(thrown!.message).toContain('`apiKey`');
    expect(thrown!.message).toContain('Fix:');
    expect(thrown!.message).not.toContain('DO-NOT-LEAK');
  });
});

// ─── The credential door (security) ─────────────────────────────────

describe('foundry() — the credential door consults getToken per request', () => {
  it('rotating tokens: the credential is asked before EVERY request, through the _client double', async () => {
    // The double replaces the WIRE, not the credential — openai()'s resolver
    // still runs the callback (and its validation) per request.
    let calls = 0;
    const credential = {
      getToken: async () => {
        calls += 1;
        return access(`tok-${calls}`);
      },
    };
    const rec = { params: [] as Array<{ model: string }> };
    const p = foundry({
      _client: fakeClient(rec),
      projectEndpoint: ENDPOINT,
      deployment: 'd',
      credential,
    });
    await p.complete(req('foundry'));
    await p.complete(req('foundry'));
    expect(calls).toBe(2);
  });

  it('a null token is refused by name — and a previously minted token is never echoed', async () => {
    // First call mints a real (planted) token; second call returns null. The
    // refusal for the second must name the condition and echo NOTHING the
    // credential ever produced.
    let calls = 0;
    const credential = {
      getToken: async (): Promise<AccessTokenLike | null> => {
        calls += 1;
        return calls === 1 ? access(PLANTED_TOKEN) : null;
      },
    };
    const p = foundry({
      _client: fakeClient({ params: [] }),
      projectEndpoint: ENDPOINT,
      deployment: 'd',
      credential,
    });
    await p.complete(req('foundry')); // token 1: fine
    let thrown: Error | undefined;
    try {
      await p.complete(req('foundry')); // token 2: null
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/^foundry: /);
    expect(thrown!.message).toContain('null');
    expect(thrown!.message).toContain('Fix:');
    expect(thrown!.message).not.toContain(PLANTED_TOKEN);
  });

  it('a credential that resolves to UNDEFINED is refused by name, exactly like null', async () => {
    // `getToken` is typed `Promise<AccessTokenLike | null>`, but this door is
    // documented as duck-typed on both public factories, so `undefined` is
    // reachable — and not only from plain JS. A token cache spelled
    // `async (s) => cache.get(String(s))!` type-checks under this repo's own
    // `strict: true` with zero errors and hands back `undefined` on a miss.
    // Before the guard covered it, that produced a raw
    // `TypeError: Cannot read properties of undefined (reading 'token')`
    // thrown from library internals: no adapter name, no `Fix:`, and through
    // azureOpenai()'s SDK path a `cause` chain the credential rules forbid.
    // Two adjacent absences, one diagnosable and one anonymous, is the bug.
    const cache = new Map<string, AccessTokenLike>();
    const credential = { getToken: async (s: string | readonly string[]) => cache.get(String(s))! };
    const p = foundry({
      _client: fakeClient({ params: [] }),
      projectEndpoint: ENDPOINT,
      deployment: 'd',
      credential,
    });
    let thrown: Error | undefined;
    try {
      await p.complete(req('foundry'));
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown!.message).toMatch(/^foundry: /);
    expect(thrown!.message).toContain('undefined');
    expect(thrown!.message).toContain(AZURE_AI_SCOPE);
    expect(thrown!.message).toContain('Fix:');
    // The old failure named the property it dereferenced; the refusal does not.
    expect(thrown!.message).not.toContain('Cannot read properties');
  });

  it('an empty `token` field is refused by FIELD NAME, never by value', async () => {
    const credential = { getToken: async () => access('   ') };
    const p = foundry({
      _client: fakeClient({ params: [] }),
      projectEndpoint: ENDPOINT,
      deployment: 'd',
      credential,
    });
    let thrown: Error | undefined;
    try {
      await p.complete(req('foundry'));
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/^foundry: /);
    expect(thrown!.message).toContain('`token` field is empty');
    expect(thrown!.message).toContain('Fix:');
  });
});

// ─── foundryInferenceUrl (pure) ─────────────────────────────────────

describe('foundryInferenceUrl()', () => {
  it('appends /openai/v1 to the project endpoint (the doc-verified derivation)', () => {
    expect(foundryInferenceUrl(ENDPOINT)).toBe(V1);
  });

  it('is idempotent on trailing slashes', () => {
    expect(foundryInferenceUrl(`${ENDPOINT}/`)).toBe(V1);
    expect(foundryInferenceUrl(`${ENDPOINT}///`)).toBe(V1);
  });

  it('is idempotent when /openai/v1 is already present (never doubled)', () => {
    expect(foundryInferenceUrl(V1)).toBe(V1);
    expect(foundryInferenceUrl(`${V1}/`)).toBe(V1);
  });

  // The derivation is a SUFFIX, so anything after a `?` or `#` swallows it:
  // `…/projects/p?x=1` + `/openai/v1` = `…/projects/p?x=1/openai/v1`, a URL
  // that constructs happily, passes the shape check (https:// and
  // /api/projects/ are both there) and then 404s on every request — the
  // late-and-far-from-the-typo failure this validator exists to prevent.
  it.each([
    ['a query string', `${ENDPOINT}?api-version=2024-12-01-preview`, '?'],
    ['a bare `?`', `${ENDPOINT}?`, '?'],
    ['a fragment', `${ENDPOINT}#overview`, '#'],
  ])('refuses %s by name rather than suffixing past it', (_case, endpoint, marker) => {
    let thrown: Error | undefined;
    try {
      foundryInferenceUrl(endpoint);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/^foundry: /);
    expect(thrown!.message).toContain(marker);
    // The endpoint is not a secret — it is echoed so the typo is visible.
    expect(thrown!.message).toContain(endpoint);
    expect(thrown!.message).toContain('Fix:');
  });

  it('the refusal fires through the factory too, not only the pure function', () => {
    expect(() =>
      foundry({
        _client: fakeClient({ params: [] }),
        projectEndpoint: `${ENDPOINT}?foo=1`,
        deployment: 'd',
        apiKey: 'k',
      }),
    ).toThrow(/foundry: .*`\?`/s);
  });

  it('an endpoint wrong in BOTH ways gets the shape diagnosis first — the more fundamental one', () => {
    expect(() => foundryInferenceUrl('https://acct.services.ai.azure.com?foo=1')).toThrow(
      /does not look like a Foundry project endpoint/,
    );
  });
});
