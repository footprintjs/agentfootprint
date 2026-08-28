/**
 * browserAzureOpenai() (fetch, no SDK) + providerFromEnv() (env-driven resolver).
 *
 * - browserAzureOpenai: a fake `_fetch` records the URL + headers + body, so we
 *   assert the deployment-scoped Azure URL, the `api-key` header, and that the
 *   model routes to the deployment — no SDK, no network.
 * - providerFromEnv: branches whose SDK is installed (`openai`) are asserted
 *   directly — kind, provider name, model. Branches whose SDK is NOT installed
 *   (`@anthropic-ai/sdk`; `@azure/identity` for the foundry arm's keyless
 *   zero-config door) still announce themselves by the distinctive
 *   peer-missing error, which proves WHICH branch was chosen; mock and the
 *   no-creds error are exact either way.
 *
 *   The Azure arm was once in the second group, and that is exactly how a
 *   configuration our own docs advertise shipped unable to boot: asserting a
 *   peer-missing throw proves the branch was ENTERED, never that its client can
 *   be built. The wire-level proof lives in
 *   test/adapters/integration/azure-openai-wire.test.ts.
 *
 *   The foundry-arm cases below assert BOTH shapes, so they hold in this
 *   checkout (peer absent by design) and in a consumer's (peer installed):
 *   direct kind/name/model when `foundry()` constructs, the foundry-named
 *   peer refusal otherwise — either way the arm's precedence and its
 *   deployment resolution are what is proven. The credential-signed wire
 *   itself is pinned by test/adapters/integration/foundry-wire.test.ts.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { browserAzureOpenai } from '../../../src/adapters/llm/BrowserOpenAIProvider.js';
import { providerFromEnv, type ProviderFromEnv } from '../../../src/adapters/llm/createProvider.js';
import { FoundryLocalUnavailableError } from '../../../src/adapters/llm/FoundryLocalProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

function recordingFetch(recorder: { url?: string; init?: RequestInit }): typeof fetch {
  return ((url: RequestInfo | URL, init?: RequestInit) => {
    recorder.url = String(url);
    recorder.init = init;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'az1',
          model: 'gpt-4o-128k',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  }) as typeof fetch;
}

const req = (model: string): LLMRequest => ({ model, messages: [{ role: 'user', content: 'q' }] });

describe('browserAzureOpenai()', () => {
  const opts = {
    endpoint: 'https://my-co.openai.azure.com',
    apiKey: 'sek-ret',
    apiVersion: '2024-12-01-preview',
    deployment: 'gpt-4o-128k',
  };

  it('builds the deployment-scoped Azure URL with the api-version', async () => {
    const rec: { url?: string; init?: RequestInit } = {};
    await browserAzureOpenai({ ...opts, _fetch: recordingFetch(rec) }).complete(req('azure'));
    expect(rec.url).toBe(
      'https://my-co.openai.azure.com/openai/deployments/gpt-4o-128k/chat/completions?api-version=2024-12-01-preview',
    );
  });

  it('reaches that same URL from a trailing slash or an endpoint already ending in /openai', async () => {
    // The two Azure doors share ./azureUrl.ts precisely so one endpoint value
    // works in both. A second `/openai` would 404 every call.
    const expected =
      'https://my-co.openai.azure.com/openai/deployments/gpt-4o-128k/chat/completions?api-version=2024-12-01-preview';
    for (const endpoint of [
      'https://my-co.openai.azure.com/',
      'https://my-co.openai.azure.com//',
      'https://my-co.openai.azure.com/openai',
      'https://my-co.openai.azure.com/openai/',
    ]) {
      const rec: { url?: string; init?: RequestInit } = {};
      await browserAzureOpenai({ ...opts, endpoint, _fetch: recordingFetch(rec) }).complete(
        req('azure'),
      );
      expect(rec.url).toBe(expected);
    }
  });

  it('authenticates with the `api-key` header (not Authorization: Bearer)', async () => {
    const rec: { url?: string; init?: RequestInit } = {};
    await browserAzureOpenai({ ...opts, _fetch: recordingFetch(rec) }).complete(req('azure'));
    const headers = rec.init!.headers as Record<string, string>;
    expect(headers['api-key']).toBe('sek-ret');
    expect(headers['authorization']).toBeUndefined();
  });

  it("routes the 'azure' shorthand model to the deployment in the body", async () => {
    const rec: { url?: string; init?: RequestInit } = {};
    await browserAzureOpenai({ ...opts, _fetch: recordingFetch(rec) }).complete(req('azure'));
    const body = JSON.parse(String(rec.init!.body));
    expect(body.model).toBe('gpt-4o-128k');
  });

  it('names itself browser-azure-openai and validates required options', () => {
    expect(browserAzureOpenai({ ...opts, _fetch: recordingFetch({}) }).name).toBe(
      'browser-azure-openai',
    );
    expect(() => browserAzureOpenai({ ...opts, endpoint: '' })).toThrow(/endpoint/i);
    expect(() => browserAzureOpenai({ ...opts, apiVersion: '' })).toThrow(/apiVersion/i);
    expect(() => browserAzureOpenai({ ...opts, deployment: '' })).toThrow(/deployment/i);
  });
});

describe('providerFromEnv()', () => {
  const VARS = [
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_ENDPOINT',
    'OPENAI_BASE_URL',
    'AZURE_OPENAI_API_VERSION',
    'AZURE_OPENAI_DEPLOYMENT',
    'MODEL_NAME',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'LLM_MODEL',
    'OLLAMA_MODEL',
    'OLLAMA_HOST',
    'FOUNDRY_PROJECT_ENDPOINT',
    'AZURE_AI_MODEL_DEPLOYMENT_NAME',
    'FOUNDRY_LOCAL_MODEL',
    'FOUNDRY_LOCAL_ENDPOINT',
    'FOUNDRY_LOCAL_BASE_URL',
  ];
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

  it('OLLAMA_MODEL selects the local provider', () => {
    process.env.OLLAMA_MODEL = 'qwen3';
    const r = providerFromEnv();
    expect(r.kind).toBe('ollama');
    expect(r.model).toBe('qwen3');
    expect(r.provider.name).toBe('ollama');
  });

  it('OLLAMA_MODEL wins over a cloud key — a named model is a declaration', () => {
    // Every other arm triggers on a CREDENTIAL, and credentials linger in a
    // shell. `OLLAMA_MODEL=qwen3` is something a person chose and typed for
    // this run; honoring the leftover key instead would ignore them and
    // charge them for it.
    process.env.ANTHROPIC_API_KEY = 'k';
    process.env.OPENAI_API_KEY = 'k';
    process.env.OLLAMA_MODEL = 'qwen3';
    expect(providerFromEnv().kind).toBe('ollama');
  });

  it('OLLAMA_HOST alone does NOT hijack an app that never asked for a local model', () => {
    // People export OLLAMA_HOST just to run Ollama. It configures the address;
    // it does not declare intent.
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(() => providerFromEnv()).toThrow(/@anthropic-ai\/sdk|anthropic/i);
  });

  it('reads no socket — resolution is env-only and instant', () => {
    // No daemon is running in this test process. If the function probed, this
    // would either hang or fail; it must simply hand back the provider and let
    // the eventual CALL be the thing that refuses.
    process.env.OLLAMA_MODEL = 'qwen3';
    process.env.OLLAMA_HOST = 'http://127.0.0.1:1';
    const started = Date.now();
    expect(providerFromEnv().kind).toBe('ollama');
    expect(Date.now() - started).toBeLessThan(100);
  });

  // ── Foundry Local — the second local-model arm ────────────────────

  it('OLLAMA_MODEL wins over FOUNDRY_LOCAL_MODEL and a full foundry config', () => {
    // Both are typed names, so precedence between them is seniority: the
    // Ollama arm came first and its position is pinned, so a shell declaring
    // both keeps doing what it always did.
    process.env.OLLAMA_MODEL = 'qwen3';
    process.env.FOUNDRY_LOCAL_MODEL = 'qwen2.5-0.5b';
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME = 'gpt-4o-128k';
    const r = providerFromEnv();
    expect(r.kind).toBe('ollama');
    expect(r.model).toBe('qwen3');
  });

  it('FOUNDRY_LOCAL_MODEL selects the local Foundry provider', () => {
    // Dependency-free (fetch + SSE, like ollama), so the arm is asserted
    // directly — no peer can be missing.
    process.env.FOUNDRY_LOCAL_MODEL = 'qwen2.5-0.5b';
    const r = providerFromEnv();
    expect(r.kind).toBe('foundry-local');
    expect(r.provider.name).toBe('foundry-local');
    expect(r.model).toBe('qwen2.5-0.5b');
  });

  it('FOUNDRY_LOCAL_ENDPOINT is honored — the provider dials that address', async () => {
    // The endpoint is not readable off the provider object, so observe it the
    // only honest way: dial it. Nothing ever listens on 127.0.0.1:1, the
    // connection refuses instantly, and the typed unavailable error carries
    // the endpoint it tried. A variant-shaped model name (`-cpu` suffix)
    // skips the catalog round-trip, so exactly one address is dialed.
    process.env.FOUNDRY_LOCAL_MODEL = 'fake-model-generic-cpu:1';
    process.env.FOUNDRY_LOCAL_ENDPOINT = 'http://127.0.0.1:1';
    const { provider, model } = providerFromEnv();
    let thrown: unknown;
    try {
      await provider.complete(req(model));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FoundryLocalUnavailableError);
    expect((thrown as FoundryLocalUnavailableError).endpoint).toBe('http://127.0.0.1:1');
  });

  it('FOUNDRY_LOCAL_MODEL beats FOUNDRY_PROJECT_ENDPOINT — a typed name outranks an injected endpoint', () => {
    // The hosted platform AUTO-INJECTS FOUNDRY_PROJECT_ENDPOINT; nobody
    // injects FOUNDRY_LOCAL_MODEL. An injected variable must never beat a
    // model name a person typed for THIS run.
    process.env.FOUNDRY_LOCAL_MODEL = 'qwen2.5-0.5b';
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME = 'gpt-4o-128k';
    expect(providerFromEnv().kind).toBe('foundry-local');
  });

  // ── Foundry (project) — the arm between the names and the keys ────
  //
  // `foundry()`'s keyless zero-config door loads the optional `@azure/identity`
  // peer at factory time, and this dev checkout deliberately leaves it
  // uninstalled. So each case accepts either outcome and asserts it FULLY:
  // with the peer present, the resolution directly (kind, provider name,
  // model); without it, foundry's OWN peer-missing refusal — which still
  // proves the arm was entered AND that a deployment was resolved, because
  // the missing-deployment refusal this resolver authors would have fired
  // BEFORE `foundry()` was called. The credential-signed path is pinned at
  // the wire by test/adapters/integration/foundry-wire.test.ts.

  function enterFoundryArm(): { resolved?: ProviderFromEnv; refusal?: string } {
    try {
      return { resolved: providerFromEnv() };
    } catch (err) {
      return { refusal: (err as Error).message };
    }
  }

  function expectFoundryArm(
    outcome: { resolved?: ProviderFromEnv; refusal?: string },
    deployment: string,
  ): void {
    if (outcome.resolved) {
      expect(outcome.resolved.kind).toBe('foundry');
      expect(outcome.resolved.provider.name).toBe('foundry');
      expect(outcome.resolved.model).toBe(deployment);
    } else {
      // The adapter's refusal, by its own name — not this resolver's
      // missing-deployment refusal, not some other arm's error.
      expect(outcome.refusal).toMatch(/^foundry: /);
      expect(outcome.refusal).toContain('@azure/identity');
      expect(outcome.refusal).not.toContain('no model deployment is named');
    }
  }

  it('FOUNDRY_PROJECT_ENDPOINT + AZURE_AI_MODEL_DEPLOYMENT_NAME selects the foundry arm; model = the deployment', () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME = 'gpt-4o-128k';
    expectFoundryArm(enterFoundryArm(), 'gpt-4o-128k');
  });

  it('MODEL_NAME is the deployment fallback on the foundry arm', () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    process.env.MODEL_NAME = 'phi-4-mini';
    expectFoundryArm(enterFoundryArm(), 'phi-4-mini');
  });

  it('FOUNDRY_PROJECT_ENDPOINT beats the full Azure-OpenAI env set — a product-specific spelling nobody exports by accident outranks lingering credentials', () => {
    // The Azure config below is complete and BOOTABLE — the Azure arm would
    // resolve it happily — so any outcome other than the foundry arm's would
    // surface here as a resolved azure-openai kind.
    process.env.AZURE_OPENAI_API_KEY = 'k';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://x.openai.azure.com';
    process.env.AZURE_OPENAI_API_VERSION = '2024-12-01-preview';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'azure-armed-deployment';
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME = 'gpt-4o-128k';
    expectFoundryArm(enterFoundryArm(), 'gpt-4o-128k');
  });

  // ── The endpoint alone: the arm steps aside ───────────────────────
  //
  // The hosted Foundry platform AUTO-INJECTS FOUNDRY_PROJECT_ENDPOINT into
  // every container it runs — including a container whose agent calls
  // Anthropic/OpenAI/Azure and never asked for Foundry INFERENCE, which is a
  // combination this project's own hosting adapter (foundryResponsesHost)
  // ships for and its docs bless. An endpoint with no deployment therefore
  // must not throw: it HOLDS its refusal, every arm below answers exactly as
  // it did before this arm existed, and the held refusal is raised only when
  // nothing else in the environment resolves. Otherwise a MINOR version bump
  // converts a booting container into a startup crash.

  it('an injected endpoint with no deployment does NOT break a bootable Azure config — either spelling of the resource root', () => {
    // AZURE_OPENAI_DEPLOYMENT, not MODEL_NAME, on purpose: MODEL_NAME would
    // feed the foundry arm's own deployment fallback, and then this would be
    // testing the foundry arm rather than the fall-through. Spelled the Azure
    // way, the foundry arm cannot see the deployment at all — so it steps
    // aside and the Azure arm answers, exactly as it answered before 9.74.
    for (const spelling of ['AZURE_OPENAI_ENDPOINT', 'OPENAI_BASE_URL'] as const) {
      delete process.env.AZURE_OPENAI_ENDPOINT;
      delete process.env.OPENAI_BASE_URL;
      process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
      process.env[spelling] = 'https://my-co.openai.azure.com';
      process.env.AZURE_OPENAI_API_KEY = 'k';
      process.env.AZURE_OPENAI_API_VERSION = '2024-12-01-preview';
      process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-4o-128k';
      const r = providerFromEnv();
      expect(r.kind).toBe('azure-openai');
      expect(r.provider.name).toBe('azure-openai');
      expect(r.model).toBe('gpt-4o-128k');
    }
  });

  it('an injected endpoint with no deployment lets the Anthropic arm answer', () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    process.env.ANTHROPIC_API_KEY = 'k';
    let thrown: unknown;
    try {
      providerFromEnv();
    } catch (err) {
      thrown = err;
    }
    // `@anthropic-ai/sdk` is deliberately uninstalled here, so the anthropic
    // arm announces itself by its own peer refusal — which is the proof this
    // case needs: the arm was ENTERED. What must never appear is the foundry
    // refusal, which would mean the endpoint pre-empted it.
    expect((thrown as Error).message).toMatch(/@anthropic-ai\/sdk|anthropic/i);
    expect((thrown as Error).message).not.toContain('no model deployment is named');
  });

  it('an injected endpoint with no deployment lets the OpenAI arm resolve outright', () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    process.env.OPENAI_API_KEY = 'k';
    const r = providerFromEnv();
    expect(r.kind).toBe('openai');
    expect(r.provider.name).toBe('openai');
  });

  it('{ fallbackToMock: true } still reaches the mock under an injected endpoint', () => {
    // The documented escape hatch (docs/guides/adapters.md, examples/features/
    // 16-providers.ts, and this function's own @example). A throw above the
    // mock return would make the contract line "or returns the mock when
    // { fallbackToMock: true }" false in a configuration the PLATFORM creates
    // on its own — the worst kind of false, because nobody wrote it.
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    const r = providerFromEnv({ fallbackToMock: true });
    expect(r.kind).toBe('mock');
    expect(r.model).toBe('mock');
  });

  it('raises the HELD Foundry refusal — not the generic catalogue — when nothing else resolves', () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    // A lone Azure KEY with no endpoint: enough to put a credential in the
    // shell (so the no-echo law below is testable), never enough to satisfy
    // the Azure arm, which needs the key AND a resource root. So no arm
    // resolves and the held refusal is what surfaces.
    process.env.AZURE_OPENAI_API_KEY = 'sk-foundry-DO-NOT-LEAK-4c1d';
    let thrown: unknown;
    try {
      providerFromEnv();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    // The exact refusal, unchanged in its first line ...
    expect(message).toContain(
      'providerFromEnv: a Foundry project endpoint is set, but no model deployment is named.',
    );
    // ... it teaches BOTH spellings of the fix ...
    expect(message).toContain('AZURE_AI_MODEL_DEPLOYMENT_NAME');
    expect(message).toContain('MODEL_NAME');
    // ... it is the HELD one, not the six-provider catalogue: a person who
    // exported a Foundry endpoint is told the one variable they are missing.
    expect(message).not.toContain('no provider declared in the environment');
    // ... and it never echoes the credential that was in the shell.
    expect(message).not.toContain('sk-foundry-DO-NOT-LEAK-4c1d');
  });

  // ── Blank is unset, everywhere in these arms ──────────────────────

  it('a blank AZURE_AI_MODEL_DEPLOYMENT_NAME does not mask a set MODEL_NAME', () => {
    // `AZURE_AI_MODEL_DEPLOYMENT_NAME=` — a declared-but-empty line, the usual
    // way to comment a variable out — is `''`, which `??` passes on as a real
    // value. The deployment behind it was then never consulted and the refusal
    // denied a deployment was named while one sat in the environment.
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME = '';
    process.env.MODEL_NAME = 'phi-4-mini';
    expectFoundryArm(enterFoundryArm(), 'phi-4-mini');
  });

  it('a whitespace-only deployment name is not a deployment name — and a padded one is trimmed', () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = 'https://acct.services.ai.azure.com/api/projects/proj';
    process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME = '   ';
    process.env.MODEL_NAME = '  phi-4-mini  ';
    expectFoundryArm(enterFoundryArm(), 'phi-4-mini');
  });

  it('a whitespace-only FOUNDRY_PROJECT_ENDPOINT is unset — it neither enters the arm nor holds a refusal', () => {
    process.env.FOUNDRY_PROJECT_ENDPOINT = '  ';
    process.env.OPENAI_API_KEY = 'k';
    expect(providerFromEnv().kind).toBe('openai');
  });

  it('a whitespace-only FOUNDRY_LOCAL_MODEL is unset — a blank name never selects the local runtime', () => {
    process.env.FOUNDRY_LOCAL_MODEL = ' ';
    process.env.OPENAI_API_KEY = 'k';
    expect(providerFromEnv().kind).toBe('openai');
  });

  it('a blank FOUNDRY_LOCAL_ENDPOINT falls through to FOUNDRY_LOCAL_BASE_URL', async () => {
    // With `??` the blank spelling won and, being falsy, was then dropped —
    // so the provider silently dialed the DEFAULT port while the address the
    // person actually set sat one variable away. Observed the only honest
    // way: dial it (nothing listens on 127.0.0.1:1, and the typed unavailable
    // error carries the endpoint it tried).
    process.env.FOUNDRY_LOCAL_MODEL = 'fake-model-generic-cpu:1';
    process.env.FOUNDRY_LOCAL_ENDPOINT = '';
    process.env.FOUNDRY_LOCAL_BASE_URL = 'http://127.0.0.1:1';
    const { provider, model } = providerFromEnv();
    let thrown: unknown;
    try {
      await provider.complete(req(model));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FoundryLocalUnavailableError);
    expect((thrown as FoundryLocalUnavailableError).endpoint).toBe('http://127.0.0.1:1');
  });

  it('detects Azure first among the credential arms (Azure env → the azure branch)', () => {
    process.env.OPENAI_BASE_URL = 'https://x.openai.azure.com';
    process.env.AZURE_OPENAI_API_KEY = 'k';
    process.env.AZURE_OPENAI_API_VERSION = '2024-12-01-preview';
    process.env.MODEL_NAME = 'gpt-4o-128k';
    // This used to assert a THROW: the `openai` SDK was not installed here, so
    // the azure branch announced itself by failing to load its peer. That is
    // the assertion that let "OPENAI_BASE_URL cannot boot" ship — the branch
    // was never actually built. The SDK is now a devDependency and the branch
    // is asserted directly.
    const r = providerFromEnv();
    expect(r.kind).toBe('azure-openai');
    expect(r.provider.name).toBe('azure-openai');
    // The deployment travels as the model, never the kind label 'azure'.
    expect(r.model).toBe('gpt-4o-128k');
  });

  it('refuses by name when Azure creds arrive with no deployment', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://x.openai.azure.com';
    // A DISTINCTIVE credential on purpose: the one-letter key this test used to
    // set makes the secrecy assertion below unfalsifiable, since ordinary prose
    // contains that letter.
    process.env.AZURE_OPENAI_API_KEY = 'sk-azure-DO-NOT-LEAK-9f3c';
    process.env.AZURE_OPENAI_API_VERSION = '2024-12-01-preview';
    // Asserted against THIS refusal, not against any error that happens to
    // mention a variable name: the previous pattern (`A.*B|B`) would have been
    // satisfied by an unrelated throw quoting MODEL_NAME, which is the vacuous
    // shape that let the unbootable config ship in the first place.
    let thrown: unknown;
    try {
      providerFromEnv();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    // It is the deployment refusal ...
    expect(message).toContain(
      'providerFromEnv: Azure credentials are set, but no deployment is named.',
    );
    // ... it teaches BOTH spellings of the fix ...
    expect(message).toContain('AZURE_OPENAI_DEPLOYMENT');
    expect(message).toContain('MODEL_NAME');
    // ... and it never echoes the credential it was handed.
    expect(message).not.toContain('sk-azure-DO-NOT-LEAK-9f3c');
  });

  it('falls to Anthropic when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(() => providerFromEnv()).toThrow(/@anthropic-ai\/sdk|anthropic/i);
  });

  it('falls to OpenAI when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'k';
    // Also once a peer-missing throw; now the branch itself. Zero delta in what
    // this arm RETURNS: the shorthand `'openai'` is what the adapter resolves to
    // its declared `defaultModel`, and nothing about the Azure fix touched it.
    const r = providerFromEnv();
    expect(r.kind).toBe('openai');
    expect(r.provider.name).toBe('openai');
    expect(r.model).toBe('openai');
  });

  it('LLM_MODEL, when set, is the model on the OpenAI arm', () => {
    process.env.OPENAI_API_KEY = 'k';
    process.env.LLM_MODEL = 'gpt-4o';
    expect(providerFromEnv().model).toBe('gpt-4o');
  });

  it('returns the mock with { fallbackToMock } when no creds are set', () => {
    const r = providerFromEnv({ fallbackToMock: true });
    expect(r.kind).toBe('mock');
    expect(r.model).toBe('mock');
    expect(r.provider.name).toBe('mock');
  });

  it('throws a helpful error when no creds and no fallback', () => {
    expect(() => providerFromEnv()).toThrow(/no provider declared/i);
    // The cheapest fix goes first, because it is the cheapest fix.
    expect(() => providerFromEnv()).toThrow(/OLLAMA_MODEL/);
  });
});
