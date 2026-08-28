/**
 * FoundryProvider — Microsoft Foundry (Azure AI Foundry) projects over the
 * api-version-free v1 OpenAI-compatible inference route.
 *
 * Pattern: Adapter (GoF) + Ports-and-Adapters (Cockburn 2005), composed —
 *          a thin vendor file over `openai()`'s machinery, the exact
 *          `azureOpenai()` shape.
 * Role:    Outer ring — owns EVERY Foundry spelling (the project-endpoint
 *          shape, the env-var names, the token audience, the `/openai/v1`
 *          derivation) so the `LLMProvider` port and the rest of the library
 *          never learn one. Knows nothing about agents, recorders, or
 *          compositions.
 * Emits:   N/A.
 *
 * ─── Why this exists ─────────────────────────────────────────────────
 *
 * This is the JS answer to Microsoft's
 * `FoundryChatClient(project_endpoint, model, credential)`: point at a
 * Foundry PROJECT, name a DEPLOYMENT, hand over a credential, done. The
 * doc-verified facts it is built on (learn.microsoft.com, Aug 2026):
 *
 *   • A Foundry project endpoint
 *     (`https://{account}.services.ai.azure.com/api/projects/{project}`)
 *     itself serves the v1 inference route by simple suffixing: `+ /openai/v1`.
 *     No `api-version` query, no deployment-scoped path.
 *   • The wire's `model` field carries the DEPLOYMENT name — Foundry's
 *     "model" is a deployment, exactly as on classic Azure OpenAI.
 *   • Auth is `Authorization: Bearer <Entra token or api key>` — the v1
 *     route accepts a key as a Bearer too.
 *
 * Because that route IS current OpenAI wire, this file is `openai({ baseURL,
 * legacyEndpoint: false, … })` plus Foundry's spellings — the same
 * composition `azureOpenai()` uses, with the modern dialect declared instead
 * of implied away by the custom `baseURL`.
 *
 * ─── Auth: three doors, one refused ambiguity ────────────────────────
 *
 *   • `credential` — any `@azure/identity` credential (duck-typed; the SDK
 *     is never imported for this door). Tokens are minted per request
 *     through `openai()`'s credential-callback seam.
 *   • `apiKey` — a static key, or a callback re-read per request.
 *   • NEITHER — `new DefaultAzureCredential()` via the optional
 *     `@azure/identity` peer: the platform's own blessed zero-config pattern
 *     inside a hosted Foundry container (the platform injects
 *     `FOUNDRY_PROJECT_ENDPOINT` and gives the agent a managed identity, so
 *     `foundry()` with no arguments is a complete configuration there).
 *   • BOTH `credential` and `apiKey` — refused by name. Two credentials is a
 *     config bug, not extra security.
 *
 * ─── Ceilings (stated, not worked around) ────────────────────────────
 *
 * • DEPLOYMENT NAMES HIDE THE MODEL. o-series auto-detection cannot work on
 *   an arbitrary deployment name, so `reasoning` must be declared — the same
 *   rationale, word for word, as `azureOpenai()`.
 * • INFERENCE ONLY. The token audience here is the data plane
 *   ({@link AZURE_AI_SCOPE}); the ARM control plane is a different audience
 *   and a different job — see `entraIdentity()` in the identity adapters.
 * • Everything `openai()` does not do (multi-modal, JSON-mode), this does
 *   not do either — it is the same machinery.
 */

import type { LLMCallHooks, LLMProvider, LLMRequest, WireRole } from '../types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { entraBearerToken, openai } from './OpenAIProvider.js';
import type { OpenAIProviderOptions } from './OpenAIProvider.js';
import { AZURE_AI_SCOPE } from '../identity/azure.js';
import type { AzureIdentitySdkModule, TokenCredentialLike } from '../identity/azure.js';

/** Every refusal this file authors opens with this name. */
const ADAPTER = 'foundry';

/** The endpoint shape refusals point at — quoted, never guessed at. */
const ENDPOINT_SHAPE = 'https://{account}.services.ai.azure.com/api/projects/{project}';

// ─── Options ────────────────────────────────────────────────────────

export interface FoundryProviderOptions {
  /**
   * The Foundry PROJECT endpoint —
   * `https://{account}.services.ai.azure.com/api/projects/{project}`, copied
   * from the Foundry portal. Env fallback: `FOUNDRY_PROJECT_ENDPOINT`, which
   * hosted Foundry containers get AUTO-INJECTED by the platform — inside one,
   * this option can simply be omitted. Required (option or env); refused by
   * name otherwise.
   */
  readonly projectEndpoint?: string;
  /**
   * The DEPLOYMENT name (Foundry's "model"). Env fallbacks:
   * `AZURE_AI_MODEL_DEPLOYMENT_NAME` — the `azd` scaffolding convention, so a
   * template-provisioned app needs no extra wiring — then `MODEL_NAME`.
   * Required (option or env); refused by name otherwise.
   */
  readonly deployment?: string;
  /**
   * Keyless (Microsoft Entra ID) auth — any `@azure/identity` credential
   * (`DefaultAzureCredential`, `ManagedIdentityCredential`, …), duck-typed so
   * this file never imports that SDK. Consulted before EVERY request through
   * `openai()`'s credential-callback seam, so MSAL's cache does the pacing
   * and an expired token is a fresh token, never a 401.
   *
   * Mutually exclusive with `apiKey` — both together are refused by name.
   * NEITHER given constructs a `DefaultAzureCredential` (peer-dep
   * `@azure/identity`), the zero-config path hosted containers are built for.
   */
  readonly credential?: TokenCredentialLike;
  /**
   * Static api key — the v1 route accepts a key as a Bearer too. A FUNCTION
   * here is re-read before every request (`openai()`'s 9.29.0 contract).
   * Mutually exclusive with `credential`.
   */
  readonly apiKey?: string | (() => string | Promise<string>);
  /**
   * Token audience for the credential doors. Default {@link AZURE_AI_SCOPE}
   * (`https://ai.azure.com/.default`) — the ONE data-plane audience every
   * Foundry / Azure OpenAI inference call accepts. The ARM control plane
   * (`https://management.azure.com/.default`) is a DIFFERENT audience whose
   * tokens do NOT work here: Azure validates the audience on every call.
   * Ignored when `apiKey` is the door in use.
   */
  readonly scope?: string;
  /**
   * Set when the DEPLOYMENT is a **reasoning model** (o1/o3/o4-mini).
   * Deployment names are arbitrary and hide the underlying model, so this
   * cannot be auto-detected — declare it to omit `temperature` and send the
   * `developer` role. (Same rationale as `azureOpenai()`.)
   */
  readonly reasoning?: boolean;
  /** Default max tokens when the request doesn't set it. Optional. */
  readonly defaultMaxTokens?: number;
  /** @internal Pre-built client for testing — the same duck type `openai()`
   *  takes, spelled as such so the two seams can never drift apart. */
  readonly _client?: OpenAIProviderOptions['_client'];
}

// ─── URL derivation ─────────────────────────────────────────────────

/**
 * Project endpoint → the base URL the v1 inference route serves.
 *
 *   `https://acct.services.ai.azure.com/api/projects/proj`
 *     → `https://acct.services.ai.azure.com/api/projects/proj/openai/v1`
 *   …with trailing slashes → the same
 *   …already ending in `/openai/v1` → the same (idempotent — `azureUrl.ts`'s
 *   rule, applied to Foundry's suffix)
 *
 * Validation lives HERE, beside the derivation, so there is exactly ONE owner
 * of what a Foundry endpoint looks like: it must be `https://` and it must
 * contain `/api/projects/` — anything else is some OTHER Azure endpoint
 * (a resource root, an ARM URL) that would 404 or 401 far from the typo.
 * Endpoints are NOT secrets, so a malformed one is echoed back: seeing what
 * arrived is the fastest fix. The one carve-out is cleartext to LOOPBACK
 * (127.0.0.1 / localhost / [::1]) — that is how the wire tests drive the
 * REAL SDK against a local fake, and refusing bytes that cannot leave the
 * machine would buy no safety.
 *
 * A `?` or `#` is refused too, and for a reason particular to a SUFFIXING
 * derivation: `…/api/projects/p?x=1` + `/openai/v1` is
 * `…/api/projects/p?x=1/openai/v1`, where the route lives entirely inside the
 * query string. That URL is well-formed, constructs without complaint, and
 * 404s on every request — the exact "late and far from the typo" failure this
 * validator exists to convert into an early named one. The v1 inference route
 * takes no query parameters at all (that is the point of it: no
 * `api-version`), so there is nothing legitimate to preserve.
 */
export function foundryInferenceUrl(projectEndpoint: string): string {
  const trimmed = projectEndpoint.replace(/\/+$/, '');
  const loopback = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i.test(trimmed);
  const shapeOk = (/^https:\/\//i.test(trimmed) || loopback) && trimmed.includes('/api/projects/');
  if (!shapeOk) {
    throw new Error(
      `${ADAPTER}: \`projectEndpoint\` does not look like a Foundry project endpoint: ` +
        `${projectEndpoint}\n` +
        `  Expected:  ${ENDPOINT_SHAPE}\n` +
        '  Fix:  copy the project endpoint from the Foundry portal (project Overview page), or ' +
        'run where the platform injects FOUNDRY_PROJECT_ENDPOINT.',
    );
  }
  // AFTER the shape check: an endpoint that is wrong in both ways gets the
  // more fundamental diagnosis first.
  const marker = trimmed.includes('?') ? '?' : trimmed.includes('#') ? '#' : undefined;
  if (marker !== undefined) {
    throw new Error(
      `${ADAPTER}: \`projectEndpoint\` carries a \`${marker}\`, and this route is built by ` +
        `SUFFIXING the endpoint: ${projectEndpoint}\n` +
        `  Appending \`/openai/v1\` would put the entire inference path INSIDE the ` +
        `${marker === '?' ? 'query string' : 'fragment'} — a URL that constructs fine and then ` +
        `404s on every request, far from the typo.\n` +
        `  Expected:  ${ENDPOINT_SHAPE}\n` +
        `  Fix:  drop everything from the \`${marker}\` onward — the v1 route is ` +
        'api-version-free and takes no query parameters.',
    );
  }
  return trimmed.endsWith('/openai/v1') ? trimmed : `${trimmed}/openai/v1`;
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Which roles this wire carries inside `messages` — `inner`'s wire, restated
 * rather than inherited by accident (azureOpenai's stance): the v1 route is
 * OpenAI's chat-completions shape, where the system prompt rides as a message
 * (as `developer` on reasoning deployments), so all three roles survive.
 */
const CARRIES_IN_MESSAGES: readonly WireRole[] = Object.freeze(['system', 'user', 'assistant']);

/**
 * Build an `LLMProvider` for a **Microsoft Foundry project**.
 *
 * Inside a hosted Foundry container this is a COMPLETE configuration:
 *
 * @example
 *   import { foundry } from 'agentfootprint/providers';
 *
 *   const agent = Agent.create({
 *     provider: foundry(),        // endpoint injected, managed identity signs
 *     model: 'foundry',           // → the configured deployment
 *   }).build();
 *
 * Anywhere else, name the project and the deployment (and sign in, or pass a
 * credential):
 *
 * @example
 *   const provider = foundry({
 *     projectEndpoint: 'https://my-acct.services.ai.azure.com/api/projects/my-proj',
 *     deployment: 'gpt-4o-128k',
 *     credential: new DefaultAzureCredential(),
 *   });
 *
 * The request's `model` is the DEPLOYMENT name: the shorthand `'foundry'`
 * resolves to the configured default, and a concrete deployment id passes
 * through untouched (so one provider can target several deployments — the
 * azureOpenai precedent).
 */
export function foundry(options: FoundryProviderOptions = {}): LLMProvider {
  const projectEndpoint = options.projectEndpoint ?? process.env.FOUNDRY_PROJECT_ENDPOINT;
  if (!projectEndpoint) {
    throw new Error(
      `${ADAPTER}: a \`projectEndpoint\` is required — the shape is ${ENDPOINT_SHAPE}.\n` +
        '  Hosted Foundry containers have it injected as FOUNDRY_PROJECT_ENDPOINT; anywhere ' +
        'else, copy it from the Foundry portal.\n' +
        '  Fix:  pass `projectEndpoint`, or set FOUNDRY_PROJECT_ENDPOINT.',
    );
  }
  const baseURL = foundryInferenceUrl(projectEndpoint);
  const deployment =
    options.deployment ?? process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME ?? process.env.MODEL_NAME;
  if (!deployment) {
    throw new Error(
      `${ADAPTER}: a \`deployment\` is required — Foundry's "model" is the DEPLOYMENT name.\n` +
        '  Fix:  pass `deployment`, or set AZURE_AI_MODEL_DEPLOYMENT_NAME (the azd scaffolding ' +
        'convention) or MODEL_NAME.',
    );
  }
  const apiKey = resolveFoundryAuth(options);
  // Reuse ALL of openai()'s logic. The v1 route is CURRENT OpenAI wire, so the
  // custom baseURL must not demote it to the legacy dialect: `legacyEndpoint:
  // false` is the whole reason that dial is public — max_completion_tokens,
  // stream_options.include_usage, and declared forced tool choice.
  const inner = openai({
    baseURL,
    legacyEndpoint: false,
    ...(apiKey !== undefined && { apiKey }),
    defaultModel: deployment,
    ...(options.reasoning !== undefined && { reasoning: options.reasoning }),
    ...(options.defaultMaxTokens !== undefined && { defaultMaxTokens: options.defaultMaxTokens }),
    ...(options._client && { _client: options._client }),
  });
  // Foundry's "model" IS the deployment — rewrite the shorthand to it; a
  // concrete id passes through (so you can target multiple deployments).
  const withDeployment = (req: LLMRequest): LLMRequest =>
    req.model === 'foundry' ? { ...req, model: deployment } : req;

  return {
    name: 'foundry',
    // The wire is `inner`'s, so the capability is `inner`'s. Re-stating it
    // rather than inheriting by accident: this factory builds a fresh object,
    // and a dropped capability silently becomes the user/assistant floor.
    carriesInMessages: CARRIES_IN_MESSAGES,
    ...(inner.carriesForcedToolChoice !== undefined && {
      carriesForcedToolChoice: inner.carriesForcedToolChoice,
    }),
    // `hooks` is FORWARDED, not dropped — see LLMCallHooks in adapters/types.ts.
    complete: (req, hooks) => inner.complete(withDeployment(req), hooks),
    ...(inner.stream && {
      stream: (req: LLMRequest, hooks?: LLMCallHooks) => inner.stream!(withDeployment(req), hooks),
    }),
  };
}

// ─── Auth resolution ────────────────────────────────────────────────

/**
 * Options → what `openai()`'s `apiKey` slot receives. Three doors and one
 * refusal, resolved in one place so the factory above reads as composition.
 *
 * The `credential` door returns a CALLBACK, which is `openai()`'s per-request
 * credential seam: called before every request, and the SDK client is rebuilt
 * only when the returned STRING changes. That is exactly right for
 * MSAL-cached tokens — the cache serves the same string until it refreshes,
 * so a cached token costs one function call and zero client rebuilds, and a
 * refreshed one becomes a new client instead of a 401.
 */
function resolveFoundryAuth(
  options: FoundryProviderOptions,
): string | (() => string | Promise<string>) | undefined {
  // Two credentials is not "extra secure" — whichever one this factory
  // silently preferred would be the one the consumer did not think was in use.
  if (options.credential && options.apiKey) {
    throw new Error(
      `${ADAPTER}: both \`credential\` and \`apiKey\` were given, and they are two answers to ` +
        'the same question — which identity signs the request.\n' +
        '  Fix:  pass exactly one — `credential` (keyless Entra ID) or `apiKey` (static key).',
    );
  }
  if (options.credential) {
    const credential = options.credential;
    const scope = options.scope ?? AZURE_AI_SCOPE;
    return async () => entraBearerToken(ADAPTER, credential, scope);
  }
  // A string or a callback both pass straight through — `openai()` already
  // owns the re-read-per-request contract for callbacks.
  if (options.apiKey !== undefined) return options.apiKey;
  if (options._client) {
    // The injected double replaces the WIRE, not the credential — and with no
    // credential given there is nothing for a test to observe. Constructing a
    // real DefaultAzureCredential underneath a double would reach for genuine
    // cloud identity from inside a unit test, so the double runs keyless.
    return undefined;
  }
  // NEITHER door named → the platform's own blessed zero-config pattern:
  // inside a hosted Foundry container (injected FOUNDRY_PROJECT_ENDPOINT +
  // per-agent managed identity), `new DefaultAzureCredential()` is what
  // Microsoft's own FoundryChatClient does. Constructing the chain fetches
  // NOTHING — tokens are minted per request by the callback below — but the
  // peer-dep is loaded HERE, at factory time, so a missing package is refused
  // where the consumer typed `foundry(...)` (the same stance `openai()` takes
  // on its own SDK).
  let sdk: AzureIdentitySdkModule;
  try {
    sdk = lazyRequire<AzureIdentitySdkModule>('@azure/identity');
  } catch {
    throw new Error(
      `${ADAPTER}: keyless zero-config auth needs the \`@azure/identity\` package (an optional ` +
        'peer this library never bundles).\n' +
        '  Fix:  npm i @azure/identity — or pass `credential` or `apiKey` explicitly.',
    );
  }
  if (typeof sdk.DefaultAzureCredential !== 'function') {
    throw new Error(
      `${ADAPTER}: \`@azure/identity\` is installed but exports no \`DefaultAzureCredential\`.\n` +
        '  Fix:  npm i @azure/identity@^4 — or pass `credential` or `apiKey` explicitly.',
    );
  }
  const chain = new sdk.DefaultAzureCredential();
  const scope = options.scope ?? AZURE_AI_SCOPE;
  return async () => entraBearerToken(ADAPTER, chain, scope);
}
