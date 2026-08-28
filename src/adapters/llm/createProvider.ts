/**
 * createProvider — by-name factory for any built-in LLMProvider.
 *
 * Pattern: Abstract Factory (GoF) over the concrete provider factories.
 * Role:    Convenience entry point. Useful for config-driven setups
 *          where the provider is chosen at runtime (env var, feature
 *          flag, tenant preference).
 * Emits:   N/A.
 *
 * @example
 *   const kind = (process.env.LLM_PROVIDER ?? 'anthropic') as ProviderKind;
 *   const provider = createProvider({
 *     kind,
 *     apiKey: process.env.LLM_API_KEY,
 *     defaultModel: process.env.LLM_MODEL,
 *   } as CreateProviderOptions);
 *
 * For provider-specific options (Bedrock region, Ollama baseUrl, Browser
 * apiUrl, etc.) construct the underlying factory directly — this
 * helper deliberately exposes only the common subset.
 */

import type { LLMProvider } from '../types.js';
import { mock, type MockProviderOptions } from './MockProvider.js';
import { anthropic, type AnthropicProviderOptions } from './AnthropicProvider.js';
import { openai, azureOpenai, type OpenAIProviderOptions } from './OpenAIProvider.js';
import { ollama, type OllamaProviderOptions } from './OllamaProvider.js';
import { foundry, type FoundryProviderOptions } from './FoundryProvider.js';
import { foundryLocal, type FoundryLocalProviderOptions } from './FoundryLocalProvider.js';
import { bedrock, type BedrockProviderOptions } from './BedrockProvider.js';
import { gemini, type GeminiProviderOptions } from './GeminiProvider.js';
import {
  browserAnthropic,
  type BrowserAnthropicProviderOptions,
} from './BrowserAnthropicProvider.js';
import { browserOpenai, type BrowserOpenAIProviderOptions } from './BrowserOpenAIProvider.js';

/** Built-in provider kinds. Custom providers don't go through this factory. */
export type ProviderKind =
  | 'mock'
  | 'anthropic'
  | 'openai'
  | 'ollama'
  | 'foundry'
  | 'foundry-local'
  | 'bedrock'
  | 'gemini'
  | 'browser-anthropic'
  | 'browser-openai';

/**
 * Common subset of options accepted across all built-in providers.
 * Provider-specific keys (region for Bedrock, host for Ollama,
 * organization for OpenAI, apiUrl for browser) are passed through
 * verbatim — TypeScript narrows by `kind`.
 */
export type CreateProviderOptions =
  | ({ readonly kind: 'mock' } & MockProviderOptions)
  | ({ readonly kind: 'anthropic' } & AnthropicProviderOptions)
  | ({ readonly kind: 'openai' } & OpenAIProviderOptions)
  | ({ readonly kind: 'ollama' } & OllamaProviderOptions)
  | ({ readonly kind: 'foundry' } & FoundryProviderOptions)
  | ({ readonly kind: 'foundry-local' } & FoundryLocalProviderOptions)
  | ({ readonly kind: 'bedrock' } & BedrockProviderOptions)
  | ({ readonly kind: 'gemini' } & GeminiProviderOptions)
  | ({ readonly kind: 'browser-anthropic' } & BrowserAnthropicProviderOptions)
  | ({ readonly kind: 'browser-openai' } & BrowserOpenAIProviderOptions);

/**
 * Build any built-in LLMProvider from a tagged options object.
 */
export function createProvider(options: CreateProviderOptions): LLMProvider {
  switch (options.kind) {
    case 'mock':
      return mock(options);
    case 'anthropic':
      return anthropic(options);
    case 'openai':
      return openai(options);
    case 'ollama':
      return ollama(options);
    case 'foundry':
      return foundry(options);
    case 'foundry-local':
      return foundryLocal(options);
    case 'bedrock':
      return bedrock(options);
    case 'gemini':
      return gemini(options);
    case 'browser-anthropic':
      return browserAnthropic(options);
    case 'browser-openai':
      return browserOpenai(options);
    default: {
      // Exhaustiveness check — TypeScript will surface a missing case here.
      const _exhaustive: never = options;
      throw new Error(
        `createProvider: unknown kind ${JSON.stringify((_exhaustive as { kind: string }).kind)}`,
      );
    }
  }
}

/** What `providerFromEnv()` resolved: the provider + the `model` to pass to
 *  `Agent.create({ provider, model })`, and which `kind` was detected. */
export interface ProviderFromEnv {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly kind:
    | 'ollama'
    | 'foundry-local'
    | 'foundry'
    | 'azure-openai'
    | 'anthropic'
    | 'openai'
    | 'mock';
}

/**
 * An environment variable counts as SET only when it carries a non-blank value.
 *
 * `AZURE_AI_MODEL_DEPLOYMENT_NAME=` — declared but blank, the usual way to
 * comment a variable out of a `.env` — is `''`, which `??` happily hands on as
 * a real value: the `MODEL_NAME` behind it is never consulted and the refusal
 * then denies a deployment was named while one sits in the environment. A
 * whitespace-only value is the same lie with a space in it. Trimming to
 * `undefined` makes the stated fallback chain real.
 *
 * Scoped to the `FOUNDRY_*` arms, which are new here. The older arms keep
 * their exact historical truthiness — changing what `AZURE_OPENAI_API_KEY=' '`
 * means is a separate, public behavior change and not this one's to make.
 */
function declared(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value ? value : undefined;
}

/**
 * Resolve an `LLMProvider` from environment variables — drop your company's
 * values in `.env` and the right provider is configured automatically, with no
 * code branching. (Node only — reads `process.env`; the vendor SDK is lazy-loaded
 * only for the detected provider.)
 *
 * Detection order (first match wins):
 *   1. **Ollama (local)** — `OLLAMA_MODEL` names a model, e.g. `qwen3`
 *      [+ `OLLAMA_HOST` for a runtime that isn't on localhost]
 *   2. **Foundry Local (local)** — `FOUNDRY_LOCAL_MODEL` names a model, e.g.
 *      `qwen2.5-0.5b` [+ `FOUNDRY_LOCAL_ENDPOINT` | `FOUNDRY_LOCAL_BASE_URL`
 *      when the service isn't on the docs' example port]
 *   3. **Foundry (project)** — `FOUNDRY_PROJECT_ENDPOINT`
 *      + (`AZURE_AI_MODEL_DEPLOYMENT_NAME` | `MODEL_NAME`); the returned
 *      `model` is the deployment you named. Auth is whatever `foundry()`
 *      resolves — inside a hosted Foundry container that is managed identity
 *      with zero further configuration. The endpoint with NO deployment named
 *      does not match: this arm steps aside, every arm below gets its normal
 *      turn, and Foundry's refusal is raised only if none of them resolves.
 *   4. **Azure OpenAI** — `AZURE_OPENAI_API_KEY` + (`AZURE_OPENAI_ENDPOINT` |
 *      `OPENAI_BASE_URL`) + `AZURE_OPENAI_API_VERSION`
 *      + (`AZURE_OPENAI_DEPLOYMENT` | `MODEL_NAME`).
 *      `AZURE_OPENAI_ENDPOINT` and `OPENAI_BASE_URL` are two spellings of the
 *      same resource root and reach the identical URL; the returned `model` is
 *      the deployment you named.
 *   5. **Anthropic** — `ANTHROPIC_API_KEY`
 *   6. **OpenAI** — `OPENAI_API_KEY`
 * Otherwise throws (or returns the mock when `{ fallbackToMock: true }`).
 *
 * **Why the local models go first.** The credential arms trigger on a
 * CREDENTIAL, and credentials arrive in a shell by accident all the time —
 * a key exported in `.zshrc` two months ago for something else. `OLLAMA_MODEL`
 * and `FOUNDRY_LOCAL_MODEL` trigger on a NAME you had to choose and type, so
 * their presence is a declaration rather than a leftover: someone who writes
 * `OLLAMA_MODEL=qwen3` has said which model they want this run to use, and
 * honoring the cloud key instead would both ignore them and cost them money.
 * (`OLLAMA_HOST` alone is NOT a trigger — people export it just to run
 * Ollama, and it must not hijack an app that never asked for a local model.
 * The same holds for `FOUNDRY_LOCAL_ENDPOINT` / `FOUNDRY_LOCAL_BASE_URL`.)
 *
 * **Why Foundry sits between the names and the keys.**
 * `FOUNDRY_PROJECT_ENDPOINT` is a product-specific spelling nobody exports by
 * accident — and the one the hosted Foundry platform AUTO-INJECTS into its
 * containers — so where it is present AND a deployment is named, Foundry is
 * the declared destination and it outranks the lingering-credential arms
 * below. It still yields to the two local-model arms: precisely because the
 * platform can inject it, it must never beat a model name a person typed for
 * THIS run.
 *
 * **Why an endpoint alone never breaks your boot.** That same injection cuts
 * the other way. A hosted Foundry container whose agent calls Anthropic — the
 * shape this project's own hosting adapter ships for — receives the endpoint
 * whether or not anyone asked for Foundry INFERENCE, and it names no
 * deployment. So an endpoint with no deployment is not a throw: the arm holds
 * its refusal, and Azure, Anthropic, OpenAI and `fallbackToMock` all run
 * exactly as they did before this arm existed. The held refusal surfaces only
 * when the environment declares nothing else at all — where it is the most
 * useful message there is, because the endpoint is then the only clue.
 *
 * **No probing.** This function reads environment variables and nothing else.
 * It never opens a socket to see whether a daemon is up — its answer stays
 * deterministic, instant, and identical on a laptop and in CI. If `OLLAMA_MODEL`
 * is set and the daemon is down, you get the provider, and the refusal arrives
 * from the call itself with `ollama serve` in the message.
 *
 * @example
 *   import { providerFromEnv } from 'agentfootprint';
 *   const { provider, model, kind } = providerFromEnv({ fallbackToMock: true });
 *   const agent = Agent.create({ provider, model }).build();
 */
export function providerFromEnv(opts: { readonly fallbackToMock?: boolean } = {}): ProviderFromEnv {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<
    string,
    string | undefined
  >;
  if (env.OLLAMA_MODEL) {
    return {
      provider: ollama(env.OLLAMA_MODEL, {
        ...(env.OLLAMA_HOST && { baseUrl: env.OLLAMA_HOST }),
      }),
      model: env.OLLAMA_MODEL,
      kind: 'ollama',
    };
  }
  const foundryLocalModel = declared(env.FOUNDRY_LOCAL_MODEL);
  if (foundryLocalModel) {
    // Same law as OLLAMA_MODEL: a model NAME someone typed for a LOCAL runtime
    // is a declaration, not a leftover. It outranks even FOUNDRY_PROJECT_ENDPOINT
    // below — the hosted platform AUTO-INJECTS that one, and an injected
    // variable must never beat a hand-typed model name.
    // `declared()` throughout: a blanked-out FOUNDRY_LOCAL_ENDPOINT must fall
    // through to FOUNDRY_LOCAL_BASE_URL, not shadow it with an empty address.
    const localEndpoint =
      declared(env.FOUNDRY_LOCAL_ENDPOINT) ?? declared(env.FOUNDRY_LOCAL_BASE_URL);
    return {
      provider: foundryLocal(foundryLocalModel, {
        ...(localEndpoint && { endpoint: localEndpoint }),
      }),
      model: foundryLocalModel,
      kind: 'foundry-local',
    };
  }
  // Held, never thrown from inside the arm — raised at the bottom of this
  // function only if no arm below resolves. See `foundryRefusal` there.
  let foundryRefusal: Error | undefined;
  const foundryEndpoint = declared(env.FOUNDRY_PROJECT_ENDPOINT);
  if (foundryEndpoint) {
    // A product-specific spelling nobody exports by accident — and the one the
    // hosted Foundry platform injects into its containers — so a NAMED
    // deployment here outranks the lingering-credential arms below: Foundry IS
    // the declared destination.
    // MODEL_NAME is the GENERIC deployment spelling, and the Azure arm below
    // has read it since long before this arm existed. So it feeds Foundry only
    // when no bootable Azure config is present: an env that resolved to
    // azure-openai on 9.73.0 keeps resolving to azure-openai when the hosted
    // platform injects FOUNDRY_PROJECT_ENDPOINT next to it. Choosing Foundry
    // over a working Azure config takes the product-specific spelling,
    // AZURE_AI_MODEL_DEPLOYMENT_NAME — a deliberate declaration, not a leftover.
    const azureBootable = Boolean(
      env.AZURE_OPENAI_API_KEY && (env.AZURE_OPENAI_ENDPOINT ?? env.OPENAI_BASE_URL),
    );
    const foundryDeployment =
      declared(env.AZURE_AI_MODEL_DEPLOYMENT_NAME) ??
      (azureBootable ? undefined : declared(env.MODEL_NAME));
    if (foundryDeployment) {
      return {
        provider: foundry({
          projectEndpoint: foundryEndpoint,
          deployment: foundryDeployment,
        }),
        // The DEPLOYMENT string, never the kind label `'foundry'` — the Azure
        // arm's law, for the same reason: this value is handed to
        // `Agent.create({ provider, model })` and travels into traces, budgets
        // and logs, where a kind label names nothing a reader could look up.
        model: foundryDeployment,
        kind: 'foundry',
      };
    }
    // The endpoint says Foundry; nothing says WHICH deployment. Foundry routes
    // by deployment, so there is no default to guess at — but this is NOT the
    // Azure arm's situation, and it does not get the Azure arm's immediate
    // throw. The Azure arm is entered by two variables a person exported on
    // purpose; this one is entered by a variable the hosted platform injects
    // into every container it runs, including containers whose agent calls
    // Anthropic and never asked for Foundry inference. Throwing here would
    // turn a minor upgrade into a startup crash for them, and would pre-empt
    // `fallbackToMock` — the documented escape hatch — as well.
    //
    // So: HOLD the refusal and fall through. Every arm below behaves exactly
    // as it did before this arm existed. If one of them resolves, that is the
    // answer. If none does, the held refusal is thrown instead of the generic
    // "no provider declared" catalogue, because the endpoint IS a declaration
    // and naming the single variable it is missing is the more useful message.
    foundryRefusal = new Error(
      'providerFromEnv: a Foundry project endpoint is set, but no model deployment is named.\n' +
        '  Foundry routes by DEPLOYMENT (its name for the model), and there is no default.\n' +
        '  Fix:  set AZURE_AI_MODEL_DEPLOYMENT_NAME (or MODEL_NAME) to your deployment id, e.g. gpt-4o-128k.\n' +
        '  (Nothing else in this environment declares a provider either — an Azure, Anthropic or\n' +
        '   OpenAI credential, or { fallbackToMock: true }, would have been used instead of this refusal.)',
    );
  }
  const azureEndpoint = env.AZURE_OPENAI_ENDPOINT ?? env.OPENAI_BASE_URL;
  if (env.AZURE_OPENAI_API_KEY && azureEndpoint) {
    const azureDeployment = env.AZURE_OPENAI_DEPLOYMENT ?? env.MODEL_NAME;
    if (!azureDeployment) {
      // The credentials say Azure; nothing says WHICH deployment. Azure routes
      // by deployment, so there is no default to fall back to — refuse here,
      // naming the variable to set, rather than guess or send a kind label.
      throw new Error(
        'providerFromEnv: Azure credentials are set, but no deployment is named.\n' +
          '  Azure routes by DEPLOYMENT (its name for the model), and there is no default.\n' +
          '  Fix:  set AZURE_OPENAI_DEPLOYMENT (or MODEL_NAME) to your deployment id, e.g. gpt-4o-128k.',
      );
    }
    return {
      provider: azureOpenai({
        endpoint: azureEndpoint,
        apiKey: env.AZURE_OPENAI_API_KEY,
        ...(env.AZURE_OPENAI_API_VERSION && { apiVersion: env.AZURE_OPENAI_API_VERSION }),
        deployment: azureDeployment,
      }),
      // The DEPLOYMENT, not the kind label `'azure'`. This value is handed to
      // `Agent.create({ provider, model })` and from there into traces, budgets
      // and logs, where a kind label reads like a model id and names nothing a
      // reader could look up. (The other arms return `LLM_MODEL` when it is set
      // and otherwise a shorthand the adapter itself resolves to its declared
      // default model — there is no user-named model to prefer. Azure has one,
      // sitting right there in AZURE_OPENAI_DEPLOYMENT / MODEL_NAME.)
      model: azureDeployment,
      kind: 'azure-openai',
    };
  }
  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
      model: env.LLM_MODEL ?? 'anthropic',
      kind: 'anthropic',
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      provider: openai({ apiKey: env.OPENAI_API_KEY }),
      model: env.LLM_MODEL ?? 'openai',
      kind: 'openai',
    };
  }
  if (opts.fallbackToMock) {
    return {
      provider: mock({ reply: 'mock reply (no provider env set)' }),
      model: 'mock',
      kind: 'mock',
    };
  }
  // A held Foundry refusal outranks the generic catalogue: the environment did
  // declare a destination, and naming the one variable it is missing beats a
  // list of six providers the reader has already walked past.
  if (foundryRefusal) throw foundryRefusal;
  throw new Error(
    'providerFromEnv: no provider declared in the environment. Set one of:\n' +
      '  • Ollama:    OLLAMA_MODEL (a local model, e.g. qwen3 — free, no API key)\n' +
      '  • Foundry Local: FOUNDRY_LOCAL_MODEL (a local model, e.g. qwen2.5-0.5b — free, no API key)\n' +
      '  • Foundry:   FOUNDRY_PROJECT_ENDPOINT (the project endpoint — auto-injected in hosted\n' +
      '               containers) + (AZURE_AI_MODEL_DEPLOYMENT_NAME | MODEL_NAME)\n' +
      '  • Azure:     AZURE_OPENAI_API_KEY + (AZURE_OPENAI_ENDPOINT | OPENAI_BASE_URL —\n' +
      '               either spelling of the resource root, e.g. https://my-co.openai.azure.com)\n' +
      '               + AZURE_OPENAI_API_VERSION + (AZURE_OPENAI_DEPLOYMENT | MODEL_NAME)\n' +
      '  • Anthropic: ANTHROPIC_API_KEY\n' +
      '  • OpenAI:    OPENAI_API_KEY\n' +
      '  …or call providerFromEnv({ fallbackToMock: true }).',
  );
}
