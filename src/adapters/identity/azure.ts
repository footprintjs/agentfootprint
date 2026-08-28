/**
 * entraIdentity — the {@link CredentialProvider} port over Microsoft Entra ID
 * (peer-dep `@azure/identity`).
 *
 *   import { entraIdentity } from 'agentfootprint/security';
 *   const credentials = entraIdentity();
 *
 * ── What it is, and what it deliberately is not ─────────────────────────────
 * This is the **narrow** adapter: it vends *Entra* access tokens for *Azure*
 * APIs, from whatever credential the environment already has — the
 * DefaultAzureCredential chain walks environment service principal, workload
 * identity, managed identity, VS Code, Azure CLI, Azure PowerShell and the
 * Azure Developer CLI, in that order. That is one job and it is done
 * completely.
 *
 * It is **not** a user-delegation surface. Entra's on-behalf-of flow (and any
 * 3-legged consent dance) needs a confidential client app registration that
 * this adapter does not hold, so `mode: 'user'` is **refused by name** rather
 * than quietly served with a machine token. A machine token returned where a
 * user token was asked for is the exact silent downgrade the port exists to
 * prevent: the call succeeds, the data comes back, and it was the agent's
 * access rather than the person's. OBO is a later train; when it lands it will
 * be its own provider, not a flag here.
 *
 * ── The audience split, and where it bites ──────────────────────────────────
 * Azure tokens are minted for ONE audience. {@link AZURE_AI_SCOPE}
 * (`https://ai.azure.com/.default`) is the data plane — every Foundry and
 * Azure OpenAI inference call takes it. {@link AZURE_MANAGEMENT_SCOPE}
 * (`https://management.azure.com/.default`) is the ARM control plane —
 * listing deployments, creating resources. A token for one audience is a 401
 * on the other, which is why BOTH are exported by name instead of leaving the
 * caller to guess a string. The default here is the data-plane scope, because
 * vending inference credentials is what an agent runtime does all day.
 *
 * ── Caching: the credential, never a token ──────────────────────────────────
 * One `DefaultAzureCredential` is constructed for the life of the provider and
 * every `getToken` call goes through it. MSAL — the machinery underneath
 * `@azure/identity` — caches and proactively refreshes tokens internally, so
 * caching a token HERE would mean owning an expiry this adapter did not
 * compute and cannot see revoked. Unlike the Google adapter (where scopes are
 * fixed at client construction and a different scope set needs its own
 * client), Azure scopes travel per `getToken` call, so the ONE cached
 * credential serves every scope set.
 *
 * ── Secrets ─────────────────────────────────────────────────────────────────
 * The `sdkFailure` law, same as every other credential-touching adapter here:
 * the library's own message never comes through, because auth libraries echo
 * request detail into 401/403 text and a message thrown from a
 * `CredentialProvider` reaches the LLM as a tool result AND rides
 * `agentfootprint.credential.failed` to every sink. What comes through is the
 * operation that failed and the error's NAME. The original is not attached as
 * `cause` — a cause travels into every serializer that walks own properties,
 * which would undo all of it in one `JSON.stringify`.
 *
 * Pattern: Adapter (GoF) + lazy peer-dep load — `@azure/identity` is required
 * the first time `getCredential` runs, or never if you inject a credential.
 */

import { lazyRequire } from '../../lib/lazyRequire.js';
import { bearer } from '../../identity/kinds.js';
import type {
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
} from '../../identity/types.js';

const ADAPTER = 'entraIdentity';

/**
 * The data-plane scope for ALL Foundry / Azure OpenAI inference
 * (`https://ai.azure.com/.default`). This is the default scope this provider
 * requests.
 *
 * The audience split matters: a token minted for this scope does NOT work on
 * the ARM control plane, and a {@link AZURE_MANAGEMENT_SCOPE} token does not
 * work here — Azure validates the audience on every call. Both are exported by
 * name so nobody has to remember which string is which.
 */
export const AZURE_AI_SCOPE = 'https://ai.azure.com/.default';

/**
 * The ARM control-plane scope (`https://management.azure.com/.default`) —
 * listing deployments, managing resources. A DIFFERENT audience from
 * {@link AZURE_AI_SCOPE}: a token for one is a 401 on the other, which is why
 * both are named rather than leaving the caller to guess.
 */
export const AZURE_MANAGEMENT_SCOPE = 'https://management.azure.com/.default';

/**
 * The CLASSIC Azure OpenAI data-plane scope
 * (`https://cognitiveservices.azure.com/.default`) — the audience Microsoft's
 * own keyless guidance names for the older deployment-scoped route
 * (`{endpoint}/openai/deployments/{d}/…`), which is the route `azureOpenai()`
 * builds and therefore its default. Current resources widely accept
 * {@link AZURE_AI_SCOPE} too, but an older `*.openai.azure.com` resource may
 * not — and a door should default to the audience ITS route documents, not the
 * one its sibling uses. (Azure Government spells this
 * `https://cognitiveservices.azure.us/.default`.)
 */
export const AZURE_COGNITIVE_SERVICES_SCOPE =
  'https://cognitiveservices.azure.com/.default';

/**
 * The `@azure/core-auth` `TokenCredential` duck type — the slice this adapter
 * calls. Anything `@azure/identity` exports (DefaultAzureCredential,
 * ManagedIdentityCredential, ClientSecretCredential, …) satisfies it.
 *
 * These are THE shared Azure credential duck-types for the whole repo: sibling
 * Azure adapters `import type` them from this file rather than re-declaring
 * their own spelling of the same SDK surface.
 */
export interface TokenCredentialLike {
  /**
   * Mint (or serve from MSAL's internal cache) an access token for the given
   * scope(s). May resolve to `null` — the SDK's spelling of "no token
   * available" — which this adapter refuses by name rather than passing along.
   */
  getToken(scopes: string | readonly string[], options?: unknown): Promise<AccessTokenLike | null>;
}

/**
 * The `@azure/core-auth` `AccessToken` duck type. `expiresOnTimestamp` is unix
 * MILLISECONDS — the port reports unix SECONDS, and the conversion lives in
 * exactly one place ({@link entraIdentity}'s vend path).
 *
 * Shared repo-wide alongside {@link TokenCredentialLike} — sibling Azure
 * adapters `import type` it from here.
 */
export interface AccessTokenLike {
  /** The bearer token itself. A SECRET — never echoed, never logged. */
  readonly token: string;
  /** Expiry in unix MILLISECONDS epoch (the SDK's unit, not the port's). */
  readonly expiresOnTimestamp: number;
  /** MSAL's proactive-refresh hint, when the SDK provides one. */
  readonly refreshAfterTimestamp?: number;
  /** 'Bearer' | 'pop'; absent on older SDK versions. */
  readonly tokenType?: string;
}

/** The slice of `@azure/identity` this adapter loads. */
export interface AzureIdentitySdkModule {
  readonly DefaultAzureCredential?: new () => TokenCredentialLike;
}

/** Options for {@link entraIdentity}. */
export interface EntraIdentityOptions {
  /**
   * The scopes to request. Default `[AZURE_AI_SCOPE]` — the data-plane
   * audience every Foundry / Azure OpenAI inference call accepts.
   *
   * A request's own `scopes` win when it names any — a tool that knows it
   * needs the control plane says so, and this is where that is honoured.
   */
  readonly scopes?: readonly string[];
  /**
   * Which downstream services this provider will answer for.
   *
   * Unset — the default — it answers for ANY `service`, because the token it
   * vends is an Entra credential and the caller knows better than this
   * adapter which Azure API they are about to call.
   *
   * Set it and a request for a service outside the list is refused BY NAME
   * rather than served. That is the useful setting in a deployment where
   * tools declare `needs: [{ credential: 'github' }]` alongside Azure ones:
   * without it, this provider would happily hand an Entra access token to the
   * tool that wanted a GitHub one, and the failure would surface as a
   * puzzling 401 from GitHub rather than as a wiring error here.
   */
  readonly services?: readonly string[];
  /** Stable provider id (default `'entra-identity'`). */
  readonly id?: string;
  /**
   * @internal Test seam — a pre-built credential. Bypasses the SDK entirely,
   * so the suite runs with no package and no Azure account.
   */
  readonly _credential?: TokenCredentialLike;
  /** @internal Test seam — the SDK module, to exercise the real construction. */
  readonly _sdk?: AzureIdentitySdkModule;
}

/**
 * What this adapter keeps between calls: the CREDENTIAL, never a token.
 *
 * The distinction matters. Caching a token would mean this adapter owning an
 * expiry it did not compute and cannot see revoked. Caching the credential
 * means MSAL's own cache-and-refresh machinery (inside `@azure/identity`)
 * runs on every call and the token is fresh because somebody whose job that
 * is says it is.
 */
interface CachedAzureCredential {
  credential?: TokenCredentialLike;
}

/**
 * Vend Entra access tokens from whatever credential this environment has —
 * the DefaultAzureCredential chain: environment service principal, workload
 * identity, managed identity, VS Code, Azure CLI, Azure PowerShell, Azure
 * Developer CLI. (`AZURE_TOKEN_CREDENTIALS` can restrict the chain; that is
 * the SDK's own dial and this adapter does not second-guess it.)
 *
 * @throws when `mode: 'user'` is requested — no user-delegation surface is
 *   wired for Entra yet (on-behalf-of is a later train), and a machine token
 *   returned in its place would be a silent downgrade.
 * @throws when `services` is configured and the request names another one.
 *
 * @example  A tool that calls an Azure API with the deployment's own identity
 *   const agent = Agent.create({ provider, credentials: entraIdentity() })
 *     .tool(defineTool({
 *       name: 'ask_foundry',
 *       needs: [{ credential: 'azure-ai' }],
 *       execute: async (args, ctx) =>
 *         fetch(url, { headers: ctx.credential!.toHeaders() }).then((r) => r.text()),
 *     }))
 *     .build();
 *
 * @example  A control-plane token, without touching the data-plane default
 *   entraIdentity({ scopes: [AZURE_MANAGEMENT_SCOPE] });
 */
export function entraIdentity(options: EntraIdentityOptions = {}): CredentialProvider {
  const defaultScopes = options.scopes ?? [AZURE_AI_SCOPE];
  const allowed = options.services === undefined ? undefined : new Set(options.services);
  const cache: CachedAzureCredential = {};

  const resolveCredential = (): TokenCredentialLike => {
    if (options._credential) return options._credential;
    // ONE credential for the life of the provider — scopes ride on getToken
    // per call (unlike Google, where they are fixed at client construction),
    // so no per-scope keying is needed. MSAL underneath caches and refreshes
    // tokens on its own; we cache the CREDENTIAL, never a token.
    if (cache.credential) return cache.credential;
    const mod = loadIdentitySdk(options._sdk);
    if (typeof mod.DefaultAzureCredential !== 'function') {
      throw new Error(
        `${ADAPTER}: \`@azure/identity\` is installed but exports no ` +
          `\`DefaultAzureCredential\`. This adapter is built against the 4.x package — ` +
          `update it, or pass \`_credential\`.`,
      );
    }
    cache.credential = new mod.DefaultAzureCredential();
    return cache.credential;
  };

  return {
    id: options.id ?? 'entra-identity',

    async getCredential(req: CredentialRequest): Promise<CredentialResult> {
      if (req.mode === 'user') {
        throw new Error(
          `${ADAPTER}: a \`mode: 'user'\` request arrived for '${req.service}', and this ` +
            `provider cannot serve one.\n` +
            `  It vends the DEPLOYMENT's Entra credential (the DefaultAzureCredential ` +
            `chain — environment service principal, workload identity, managed identity, ` +
            `or a developer's \`az login\`). No user-delegation surface is wired for Entra ` +
            `yet — the on-behalf-of flow is a later train.\n` +
            `  Returning a machine token here would succeed and be wrong: the call would ` +
            `run with the AGENT's access rather than the person's, and nothing downstream ` +
            `could tell.\n` +
            `  Fix:  declare \`mode: 'machine'\` if the deployment's own identity is really ` +
            `what you want, or vend the user's token from a provider that holds one.`,
        );
      }
      if (req.userToken !== undefined) {
        // A user's signed token handed to a provider that cannot exchange it.
        // Named rather than ignored: without a confidential client app
        // registration there is no on-behalf-of exchange to perform, and
        // silently dropping somebody's proof and vending machine access is
        // the same downgrade in a quieter costume.
        throw new Error(
          `${ADAPTER}: a \`userToken\` arrived for '${req.service}', but this provider has ` +
            `nothing to exchange it against — the on-behalf-of flow needs a confidential ` +
            `client app registration, and this provider vends the deployment's own Entra ` +
            `credential.\n` +
            `  Ignoring it would hand back agent-scoped access while holding the user's ` +
            `proof. Drop the token, or use a provider that can exchange one.`,
        );
      }
      if (allowed !== undefined && !allowed.has(req.service)) {
        throw new Error(
          `${ADAPTER}: this provider is configured for [${[...allowed].join(', ')}] and was ` +
            `asked for '${req.service}'.\n` +
            `  It vends ENTRA access tokens; handing one to a tool that wanted a different ` +
            `service's credential would fail downstream as a puzzling 401 instead of here ` +
            `as a wiring error.\n` +
            `  Fix:  add '${req.service}' to 'services', or attach a provider that serves it.`,
        );
      }

      let credential: TokenCredentialLike;
      try {
        credential = resolveCredential();
      } catch (err) {
        // A refusal this adapter authored (a missing peer dependency, a
        // too-old SDK) is already the right diagnosis; rewriting it through
        // sdkFailure would send the reader chasing Entra sign-in logs for a
        // problem `npm install` fixes. Wrong diagnoses are their own kind of
        // silently-wrong.
        if (isOwnRefusal(err)) throw err;
        throw sdkFailure('new DefaultAzureCredential', err);
      }

      // A request's own non-empty scopes win over the provider's default.
      // The array goes to getToken as-is — Azure scopes are per-call, and
      // `.default` scopes are single-element by convention anyway.
      const scopes = req.scopes !== undefined && req.scopes.length > 0 ? req.scopes : defaultScopes;

      let answer: AccessTokenLike | null;
      try {
        answer = await credential.getToken(scopes);
      } catch (err) {
        throw sdkFailure('getToken', err);
      }

      const token = answer?.token;
      if (typeof token !== 'string' || token.trim() === '') {
        // The SCOPES are quoted; nothing else is. An audience URI is public,
        // and it is the datum most often wrong here — "could not mint for the
        // requested scope" is useless when the reader cannot see WHICH scope
        // was requested (a tool that declares `needs` without `scopes` gets
        // this provider's default, which it never typed anywhere). The token
        // response's own fields stay withheld: every one of them is a secret.
        // Same conclusion `entraBearerToken` reached out loud in
        // src/adapters/llm/OpenAIProvider.ts — the two siblings now agree.
        throw new Error(
          `${ADAPTER}: the credential resolved but vended no access token for ` +
            `'${req.service}' at scope${scopes.length === 1 ? '' : 's'} ` +
            `[${scopes.join(', ')}] — ${
              answer === null
                ? '`getToken` returned null, the SDK\'s spelling of "no token available"'
                : "the response's `token` field was empty"
            }.\n` +
            `  No token value is quoted here on purpose — every field of a token response is ` +
            `a secret. This usually means the chain found a credential source that could not ` +
            `actually mint for THAT audience.\n` +
            `  Fix:  check the audience first — inference is ${AZURE_AI_SCOPE} and the ARM ` +
            `control plane is ${AZURE_MANAGEMENT_SCOPE}; name the right one in the request's ` +
            `\`scopes\` or this provider's \`scopes\` option. If it is already right, sign in as ` +
            `an identity that can mint for it (\`az login\`, or a managed identity with the role).`,
        );
      }

      // The SDK records expiry in unix MILLISECONDS; the port reports unix
      // SECONDS. Reported when known and omitted when not — an invented
      // expiry is worse than none, because a caller would cache against it.
      // (`answer` cannot be null past the token guard; the optional chain is
      // for the compiler, which does not carry the narrowing across fields.)
      const expiryMs = answer?.expiresOnTimestamp;
      const expiresAt =
        typeof expiryMs === 'number' && Number.isFinite(expiryMs) && expiryMs > 0
          ? Math.floor(expiryMs / 1000)
          : undefined;

      return {
        status: 'issued',
        credential: bearer(token),
        ...(expiresAt !== undefined && { expiresAt }),
      };
    },
  };
}

// ─── Internals ───────────────────────────────────────────────────────

function loadIdentitySdk(injected: AzureIdentitySdkModule | undefined): AzureIdentitySdkModule {
  if (injected) return injected;
  try {
    return lazyRequire<AzureIdentitySdkModule>('@azure/identity');
  } catch {
    throw new Error(
      `${ADAPTER} requires the \`@azure/identity\` peer dependency.\n` +
        `  Install:  npm install @azure/identity\n` +
        `  It is optional and loaded only when this provider first vends, so nothing else ` +
        `in this library pays for it.`,
    );
  }
}

/**
 * "There is no usable credential here" — the most common real failure, given
 * the fix instead of the library's own text. `@azure/identity` names it
 * `CredentialUnavailableError` (one rung) or `AggregateAuthenticationError`
 * (the whole chain came up empty); both mean the same thing to the reader.
 */
function credentialsUnavailable(name: string): Error {
  const failure = new Error(
    `${ADAPTER}: could not acquire an Entra token in this environment — ${name}.\n` +
      `  The underlying message is withheld: auth libraries echo request detail into ` +
      `failure text, and this message reaches the model as a tool result.\n` +
      `  Every rung of the DefaultAzureCredential chain was tried: environment service ` +
      `principal, workload identity, managed identity, VS Code, Azure CLI, Azure ` +
      `PowerShell, Azure Developer CLI.\n` +
      `  Fix:  run \`az login\`, or set AZURE_CLIENT_ID / AZURE_TENANT_ID / ` +
      `AZURE_CLIENT_SECRET, or run where a managed identity exists, or pass \`_credential\`.`,
  );
  failure.name = 'AzureCredentialsUnavailableError';
  return failure;
}

/** Re-raise without the library's text. See the module header for why. */
function sdkFailure(operation: string, err: unknown): Error {
  const name = errorName(err);
  // The no-credential names get the fix, not just the diagnosis — but ONLY
  // those names. Everything else is reported as what it is.
  if (name === 'CredentialUnavailableError' || name === 'AggregateAuthenticationError') {
    return credentialsUnavailable(name);
  }
  const failure = new Error(
    `${ADAPTER}: ${operation} failed — ${name}.\n` +
      `  The underlying message is withheld: this call handles an access token, and auth ` +
      `libraries echo request detail into failure text. Check the Entra sign-in logs for ` +
      `the full error.`,
  );
  failure.name = 'AzureCredentialError';
  return failure;
}

/**
 * Did THIS adapter write this error?
 *
 * Every refusal authored here opens with the adapter's own name — both as the
 * marker and because it is what makes the message readable ("entraIdentity:
 * …", "entraIdentity requires …"). A library's own failure never does, so the
 * prefix is a reliable discriminator without an error subclass per refusal.
 */
function isOwnRefusal(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(ADAPTER);
}

function errorName(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.length > 0 ? name : 'an unnamed failure';
}
