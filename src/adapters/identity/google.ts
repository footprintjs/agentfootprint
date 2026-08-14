/**
 * googleIdentity — the {@link CredentialProvider} port over Google's own
 * credential machinery (peer-dep `google-auth-library`).
 *
 *   import { googleIdentity } from 'agentfootprint/security';
 *   const credentials = googleIdentity();
 *
 * ── What it is, and what it deliberately is not ─────────────────────────────
 * This is the **narrow** adapter: it vends *Google* access tokens for *Google*
 * APIs, from whatever credential the environment already has — Application
 * Default Credentials on Cloud Run or GKE, a workload-identity federation
 * config, a service account, optionally impersonating another service account.
 * That is one job and it is done completely.
 *
 * It is **not** a token vault and does not pretend to be one. The other
 * column's identity adapter can vend a *GitHub* token for a *user* because
 * that service runs a vault with per-user OAuth grants behind it. Google's
 * equivalent — the Agent Identity auth manager — is Preview with no Node
 * surface, so `mode: 'user'` here is **refused by name** rather than quietly
 * served with a machine token. A machine token returned where a user token was
 * asked for is the exact silent downgrade the port exists to prevent: the call
 * succeeds, the data comes back, and it was the agent's access rather than the
 * person's. See {@link googleIdentity} for the refusal's wording.
 *
 * ── The one-hour fact, and where it bites ───────────────────────────────────
 * A Google OAuth access token lives about an hour. That is fine wherever the
 * credential is fetched per use — which is how `ctx.credential` works, so the
 * ordinary path is unaffected. It bites in exactly one place, and it is worth
 * naming because it looks like it should work:
 *
 * > **The OpenAI-compatible endpoint trap.** Google publishes an
 * > OpenAI-compatible Gemini endpoint, and `openai({ baseURL, apiKey })` does
 * > reach it. If you fill that `apiKey` with a token from here, it works for
 * > an hour and then every call fails with a 401 — because `apiKey` is a
 * > STRING captured when the provider is constructed, and a long-lived agent
 * > process outlives it. There is no refresh home in the OpenAI provider's
 * > options for a credential that expires. Use the native `gemini()` provider,
 * > which reads ADC through the SDK and refreshes underneath you.
 *
 * `expiresAt` is reported on every issued credential so a caller that caches
 * one can tell. This adapter never caches: {@link CachedGoogleClient} keeps
 * the *client*, and the client's own refresh logic keeps the token fresh.
 *
 * ── Secrets ─────────────────────────────────────────────────────────────────
 * The `sdkFailure` law, same as every other credential-touching adapter here:
 * the library's own message never comes through, because auth libraries echo
 * request detail into failure text and a message thrown from a
 * `CredentialProvider` reaches the LLM as a tool result AND rides
 * `agentfootprint.credential.failed` to every sink. What comes through is the
 * operation that failed and the error's NAME. The original is not attached as
 * `cause` — a cause travels into every serializer that walks own properties,
 * which would undo all of it in one `JSON.stringify`.
 *
 * Pattern: Adapter (GoF) + lazy peer-dep load — `google-auth-library` is
 * required the first time `getCredential` runs, or never if you inject one.
 */

import { lazyRequire } from '../../lib/lazyRequire.js';
import { bearer } from '../../identity/kinds.js';
import type {
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
} from '../../identity/types.js';

const ADAPTER = 'googleIdentity';

/** The scope every Google Cloud data-plane API accepts. */
export const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * The slice of an auth client this adapter calls — a `GoogleAuth`, an
 * `OAuth2Client` and an `Impersonated` all satisfy it, which is why nothing
 * here switches on which one it has.
 */
export interface GoogleAuthClientLike {
  /** The current access token, refreshed if the library thinks it is stale. */
  getAccessToken(): Promise<{ token?: string | null } | string | null | undefined>;
  /** Where the library records the expiry it knows about, in unix ms. */
  readonly credentials?: { readonly expiry_date?: number | null };
}

/** The slice of a `GoogleAuth` this adapter calls. */
export interface GoogleAuthLike {
  getClient(): Promise<GoogleAuthClientLike>;
}

/** The slice of `google-auth-library` this adapter loads. */
export interface GoogleAuthSdkModule {
  readonly GoogleAuth?: new (options: { scopes?: readonly string[] }) => GoogleAuthLike;
  readonly Impersonated?: new (options: {
    sourceClient: GoogleAuthClientLike;
    targetPrincipal: string;
    targetScopes: string[];
    delegates?: string[];
    lifetime?: number;
  }) => GoogleAuthClientLike;
}

/** Impersonate another service account for the tokens this provider vends. */
export interface GoogleImpersonation {
  /**
   * The service account to act as, e.g.
   * `'agent-runner@my-project.iam.gserviceaccount.com'`. The credential the
   * environment already has must hold `roles/iam.serviceAccountTokenCreator`
   * on it; without that the exchange fails with a 403 whose text this adapter
   * withholds, so the permission is worth checking before you wonder why.
   */
  readonly targetPrincipal: string;
  /** A delegation chain, when one account cannot impersonate the target directly. */
  readonly delegates?: readonly string[];
  /**
   * How long the impersonated token lives, in seconds. The service's own
   * ceiling is 3600 (one hour) unless the org policy raises it, and asking for
   * more than it allows is refused by Google rather than clamped.
   */
  readonly lifetimeSeconds?: number;
}

/** Options for {@link googleIdentity}. */
export interface GoogleIdentityOptions {
  /**
   * The OAuth scopes to request. Default `[cloud-platform]`, which is what
   * every Google Cloud data-plane API accepts.
   *
   * A request's own `scopes` win when it names any — a tool that knows it only
   * needs read access should say so, and this is where that is honoured.
   */
  readonly scopes?: readonly string[];
  /**
   * Act as another service account. Off by default; see
   * {@link GoogleImpersonation}.
   */
  readonly impersonate?: GoogleImpersonation;
  /**
   * Which downstream services this provider will answer for.
   *
   * Unset — the default — it answers for ANY `service`, because the token it
   * vends is a Google credential and the caller knows better than this adapter
   * which Google API they are about to call.
   *
   * Set it and a request for a service outside the list is refused BY NAME
   * rather than served. That is the useful setting in a deployment where tools
   * declare `needs: [{ credential: 'github' }]` alongside Google ones: without
   * it, this provider would happily hand a Google access token to the tool
   * that wanted a GitHub one, and the failure would surface as a puzzling 401
   * from GitHub rather than as a wiring error here.
   */
  readonly services?: readonly string[];
  /** Stable provider id (default `'google-identity'`). */
  readonly id?: string;
  /**
   * @internal Test seam — a pre-built auth client. Bypasses the SDK entirely,
   * so the suite runs with no package and no credential.
   */
  readonly _client?: GoogleAuthClientLike;
  /** @internal Test seam — the SDK module, to exercise the real construction. */
  readonly _sdk?: GoogleAuthSdkModule;
}

/**
 * What this adapter keeps between calls: the CLIENT, never a token.
 *
 * The distinction matters. Caching a token would mean this adapter owning an
 * expiry it did not compute and cannot see revoked. Caching the client means
 * the library's own refresh logic runs on every call and the token is fresh
 * because somebody whose job that is says it is.
 */
interface CachedGoogleClient {
  client?: Promise<GoogleAuthClientLike>;
}

/**
 * Vend Google access tokens from whatever credential this environment has.
 *
 * **Status: field-validated for machine identity; refresh bounded.** An
 * independent trial ran this adapter on live Google Cloud (2026-08-14):
 * `googleIdentity({ services: ['aiplatform'] })` vended a real bearer
 * credential from Application Default Credentials, and that credential
 * authorized a Vertex AI request with HTTP 200. The same run proved the
 * `bearer` kind, an expiry about 3,599 seconds out, a second vend without
 * reconstruction, `mode: 'user'` failing CLOSED rather than quietly handing
 * back machine access, a disallowed service failing closed, and
 * `JSON.stringify(credential)` yielding `{"kind":"bearer"}` — no token, no
 * Authorization header.
 *
 * **What is NOT proven:** an expiry-triggered refresh. The trial called the
 * provider twice minutes apart and checked a future expiry; it did not wait an
 * hour. Google's own auth client is what refreshes (this adapter caches the
 * CLIENT, never a token — see {@link CachedGoogleClient}), and that refresh was
 * field-proved on a different door (`gemini({ googleAuthOptions })`). A soak or
 * a controlled expiring-credential double is still owed before anyone claims
 * long-duration production proof for THIS provider.
 *
 * @throws when `mode: 'user'` is requested — Google's per-user token vault has
 *   no Node surface, and a machine token returned in its place would be a
 *   silent downgrade.
 * @throws when `services` is configured and the request names another one.
 *
 * @example  A tool that calls a Google API with the deployment's own identity
 *   const agent = Agent.create({ provider, credentials: googleIdentity() })
 *     .tool(defineTool({
 *       name: 'read_sheet',
 *       needs: [{ credential: 'sheets', scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }],
 *       execute: async (args, ctx) =>
 *         fetch(url, { headers: ctx.credential!.toHeaders() }).then((r) => r.text()),
 *     }))
 *     .build();
 *
 * @example  Acting as a dedicated service account
 *   googleIdentity({
 *     impersonate: { targetPrincipal: 'agent-runner@my-project.iam.gserviceaccount.com' },
 *   });
 */
export function googleIdentity(options: GoogleIdentityOptions = {}): CredentialProvider {
  const defaultScopes = options.scopes ?? [CLOUD_PLATFORM_SCOPE];
  const allowed = options.services === undefined ? undefined : new Set(options.services);
  const cache: CachedGoogleClient = {};

  const clientFor = (scopes: readonly string[]): Promise<GoogleAuthClientLike> => {
    // One client for the life of the provider. Scopes are fixed at
    // construction by the library, so a request that asks for DIFFERENT scopes
    // gets its own client rather than a token minted for the wrong ones — the
    // cache is keyed on the default set and skipped otherwise.
    if (sameScopes(scopes, defaultScopes)) {
      return (cache.client ??= buildClient(options, scopes));
    }
    return buildClient(options, scopes);
  };

  return {
    id: options.id ?? 'google-identity',

    async getCredential(req: CredentialRequest): Promise<CredentialResult> {
      if (req.mode === 'user') {
        throw new Error(
          `${ADAPTER}: a \`mode: 'user'\` request arrived for '${req.service}', and this ` +
            `provider cannot serve one.\n` +
            `  It vends the DEPLOYMENT's Google credential (Application Default Credentials, ` +
            `workload identity, or an impersonated service account). It has no per-user token ` +
            `vault — Google's own (the Agent Identity auth manager) has no Node surface to ` +
            `build on.\n` +
            `  Returning a machine token here would succeed and be wrong: the call would run ` +
            `with the AGENT's access rather than the person's, and nothing downstream could ` +
            `tell.\n` +
            `  Fix:  declare \`mode: 'machine'\` if the deployment's own identity is really ` +
            `what you want, or vend the user's token from a provider that holds one.`,
        );
      }
      if (req.userToken !== undefined) {
        // A user's signed token handed to a provider that cannot exchange it.
        // Named rather than ignored: silently dropping somebody's proof and
        // vending machine access is the same downgrade in a quieter costume.
        throw new Error(
          `${ADAPTER}: a \`userToken\` arrived for '${req.service}', but this provider has ` +
            `nothing to exchange it against — it vends the deployment's own Google credential ` +
            `and cannot act on behalf of a person.\n` +
            `  Ignoring it would hand back agent-scoped access while holding the user's proof. ` +
            `Drop the token, or use a provider that can exchange one.`,
        );
      }
      if (allowed !== undefined && !allowed.has(req.service)) {
        throw new Error(
          `${ADAPTER}: this provider is configured for [${[...allowed].join(', ')}] and was ` +
            `asked for '${req.service}'.\n` +
            `  It vends GOOGLE access tokens; handing one to a tool that wanted a different ` +
            `service's credential would fail downstream as a puzzling 401 instead of here as ` +
            `a wiring error.\n` +
            `  Fix:  add '${req.service}' to 'services', or attach a provider that serves it.`,
        );
      }

      const scopes = req.scopes !== undefined && req.scopes.length > 0 ? req.scopes : defaultScopes;
      let client: GoogleAuthClientLike;
      try {
        client = await clientFor(scopes);
      } catch (err) {
        // "No credential in this environment" is the most common real failure
        // and deserves the fix rather than a library's stack trace — but ONLY
        // when that is really what happened. A refusal this adapter authored
        // (a missing peer dependency, an impersonation with no target) is
        // already the right diagnosis, and rewriting it as "no credential"
        // would send the reader to `gcloud auth` for a problem `npm install`
        // fixes. Wrong diagnoses are their own kind of silently-wrong.
        if (isOwnRefusal(err)) throw err;
        throw noCredentials(err);
      }

      let answer: Awaited<ReturnType<GoogleAuthClientLike['getAccessToken']>>;
      try {
        answer = await client.getAccessToken();
      } catch (err) {
        throw sdkFailure('getAccessToken', err);
      }

      const token = typeof answer === 'string' ? answer : answer?.token;
      if (typeof token !== 'string' || token === '') {
        throw new Error(
          `${ADAPTER}: the auth client returned no access token for '${req.service}'.\n` +
            `  No value is quoted here on purpose — every field of a token response is a ` +
            `secret. A credential that resolved but vends nothing usually means the ` +
            `environment has a config file with no usable key, or an impersonation the source ` +
            `identity is not permitted to perform.`,
        );
      }

      // The library records expiry in unix MILLISECONDS; the port reports unix
      // SECONDS. Reported when known and omitted when not — an invented expiry
      // is worse than none, because a caller would cache against it.
      const expiryMs = client.credentials?.expiry_date;
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

function sameScopes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((scope, index) => scope === b[index]);
}

/** Build the auth client: ADC, then impersonation on top when configured. */
async function buildClient(
  options: GoogleIdentityOptions,
  scopes: readonly string[],
): Promise<GoogleAuthClientLike> {
  if (options._client) return options._client;
  const mod = loadAuthSdk(options._sdk);

  if (typeof mod.GoogleAuth !== 'function') {
    throw new Error(
      `${ADAPTER}: \`google-auth-library\` is installed but exports no \`GoogleAuth\`. ` +
        `This adapter is built against the 11.x package — update it, or pass \`_client\`.`,
    );
  }
  const source = await new mod.GoogleAuth({ scopes: [...scopes] }).getClient();

  const impersonate = options.impersonate;
  if (impersonate === undefined) return source;

  if (typeof mod.Impersonated !== 'function') {
    throw new Error(
      `${ADAPTER}: 'impersonate' is configured but \`google-auth-library\` exports no ` +
        `\`Impersonated\`. Update the package, or drop 'impersonate' to vend with the ` +
        `environment's own identity.`,
    );
  }
  if (typeof impersonate.targetPrincipal !== 'string' || impersonate.targetPrincipal === '') {
    throw new TypeError(
      `${ADAPTER}: 'impersonate.targetPrincipal' is required — the service account to act as, ` +
        `e.g. 'agent-runner@my-project.iam.gserviceaccount.com'.`,
    );
  }
  return new mod.Impersonated({
    sourceClient: source,
    targetPrincipal: impersonate.targetPrincipal,
    targetScopes: [...scopes],
    ...(impersonate.delegates !== undefined && { delegates: [...impersonate.delegates] }),
    ...(impersonate.lifetimeSeconds !== undefined && { lifetime: impersonate.lifetimeSeconds }),
  });
}

function loadAuthSdk(injected: GoogleAuthSdkModule | undefined): GoogleAuthSdkModule {
  if (injected) return injected;
  try {
    return lazyRequire<GoogleAuthSdkModule>('google-auth-library');
  } catch {
    throw new Error(
      `${ADAPTER} requires the \`google-auth-library\` peer dependency.\n` +
        `  Install:  npm install google-auth-library\n` +
        `  It is optional and loaded only when this provider first vends, so nothing else in ` +
        `this library pays for it.`,
    );
  }
}

/**
 * "There is no usable credential here" — the most common real failure, given
 * the fix instead of the library's own text.
 */
function noCredentials(err: unknown): Error {
  const name = errorName(err);
  const failure = new Error(
    `${ADAPTER}: could not resolve a Google credential in this environment — ${name}.\n` +
      `  The underlying message is withheld: auth libraries echo file paths and request ` +
      `detail into failure text, and this message reaches the model as a tool result.\n` +
      `  On Cloud Run / GKE / GCE the runtime service account is used automatically. ` +
      `Elsewhere, run \`gcloud auth application-default login\`, or point ` +
      `GOOGLE_APPLICATION_CREDENTIALS at a service-account key or a workload-identity ` +
      `config file.`,
  );
  failure.name = 'GoogleCredentialsUnavailableError';
  return failure;
}

/** Re-raise without the library's text. See the module header for why. */
function sdkFailure(operation: string, err: unknown): Error {
  const failure = new Error(
    `${ADAPTER}: ${operation} failed — ${errorName(err)}.\n` +
      `  The underlying message is withheld: this call handles an access token, and auth ` +
      `libraries echo request detail into failure text. Check Cloud Logging for the full error.`,
  );
  failure.name = 'GoogleCredentialError';
  return failure;
}

/**
 * Did THIS adapter write this error?
 *
 * Every refusal authored here opens with the adapter's own name — both as the
 * marker and because it is what makes the message readable ("googleIdentity:
 * …", "googleIdentity requires …"). A library's own failure never does, so the
 * prefix is a reliable discriminator without an error subclass per refusal.
 */
function isOwnRefusal(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(ADAPTER);
}

function errorName(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.length > 0 ? name : 'an unnamed failure';
}
