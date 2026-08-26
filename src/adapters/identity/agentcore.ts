/**
 * agentCoreIdentity — AWS Bedrock AgentCore Identity adapter (peer-dep
 * `@aws-sdk/client-bedrock-agentcore`).
 *
 *   import { agentCoreIdentity } from 'agentfootprint/security';
 *   const credentials = agentCoreIdentity({ region: 'us-east-1' });
 *
 * Maps the {@link CredentialProvider} port onto AgentCore Identity's
 * `GetResourceOauth2Token` (the SDK's `@requires_access_token` underneath):
 *   - request.mode 'machine' → `M2M`; 'user' → `USER_FEDERATION`
 *   - request.service        → the configured OAuth2 credential-provider name
 *   - request.identity       → (per-request workload identity scoping; see below)
 *   - request.userToken      → the user's own JWT, exchanged for a user-scoped
 *                              workload token before vending (9.12.0; see below)
 *   - a returned access token → `{ status: 'issued', credential: bearer(token) }`
 *   - a returned auth URL     → `{ status: 'authorization-required' }` (3LO consent)
 *
 * The token vault + refresh-token handling live in AgentCore, so repeat calls
 * usually return a token directly (no consent round-trip).
 *
 * **Per-request identity forwarding (workload identity scoping).**
 * `GetResourceOauth2Token` carries NO user/tenant field — in AgentCore the
 * user identity is bound EARLIER, at workload-token acquisition. There are two
 * ways to bind it, and this adapter dispatches both:
 *
 *   `GetWorkloadAccessTokenForUserId(workloadName, userId)` — the ASSERTION.
 *     The agent says who the user is; AWS takes its word for it and returns a
 *     workload token keyed to that (workload, user).
 *   `GetWorkloadAccessTokenForJWT(workloadName, userToken)` — the PROOF (9.12.0).
 *     The agent hands over the token the user's own identity provider signed,
 *     and gets back "an opaque token representing the identity of both the
 *     workload and the user" (the service's own words for the response).
 *
 * Either way the answer is a `workloadAccessToken`, and it flows into
 * `GetResourceOauth2Token`'s `workloadIdentityToken` unchanged — which is why
 * the second one needed no new credential path, no new result branch and no
 * change to `toHeaders()`. AgentCore keys its token vault + 3LO grants per
 * (workload, user), so the whole point of resolving either is that the vault
 * entry belongs to the person rather than to the agent.
 *
 * **The JWT rides the REQUEST.** `req.userToken` is per call, because the
 * person calling is per call; a JWT in this provider's construction options
 * would be one user's session serving everybody. Presence is what selects the
 * exchange — a proof that arrived is never downgraded to an assertion — and
 * `requireUserToken` turns "no JWT on a `mode: 'user'` request" from a quiet
 * fallback into a refusal, for a deployment where every user IS authenticated.
 *
 * The ladder, in order, for one `getCredential(req)`:
 *   1. `req.userToken` present → exchange it (needs `workloadName`; `mode: 'user'`).
 *   2. else a userId derives from `req.identity` (default `identity.principal`;
 *      override via `userIdFor`) on a `mode: 'user'` request, and
 *      `options.workloadName` is configured → the by-userId exchange.
 *   3. else the static `options.workloadIdentityToken` flows exactly as before.
 *
 * `tenant` has no native AgentCore field and is NOT forwarded by default —
 * tenant isolation derives from the workload identity itself (per-tenant
 * workloads), or encode it via `userIdFor` (e.g. `${tenant}:${principal}`).
 *
 * **Secrecy.** The inbound JWT and the exchanged workload token are secrets of
 * equal weight, and neither appears in anything this file throws. A failed
 * exchange is described by the SHAPE of the response — how many fields it
 * carried and what they are called — never by its content, because every field
 * of a token-exchange response is a token. A thrown message reaches the LLM as
 * a tool result AND rides `agentfootprint.credential.failed`, so an error that
 * quotes the response has published the user's session to both at once.
 *
 * ── How this talks to the SDK (9.4.0 — read this before editing) ────────────
 * Through **`client.send(new SomeCommand(input))`**, never through a method on
 * the client. A bare `@aws-sdk/client-*` **Client** is command-based: its
 * prototype carries `send` and `destroy` and NOTHING ELSE. The per-operation
 * shortcuts (`getResourceOauth2Token(...)`) live on the AGGREGATED client
 * (`BedrockAgentCore`), which is a different class.
 *
 * Until 9.4.0 this adapter built a `BedrockAgentCoreClient` and then duck-typed
 * `client.getResourceOauth2Token` — a method that is never there — so the
 * documented path failed 100% of the time on the very first call, with a
 * message blaming the SDK version. Every test injected `_client` and so never
 * touched the shim. The sibling memory adapter in this same package had the
 * command form right all along; this one now matches it, and
 * `test/adapters/aws/aws-command-pin.test.ts` pins the command names for both.
 *
 * Pattern: Adapter (GoF) + lazy peer-dep load — the AWS SDK is required only when
 * `getCredential` first runs (or never, if you inject `_client` / `_sdk`).
 */

import { lazyRequire } from '../../lib/lazyRequire.js';
import type {
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
} from '../../identity/types.js';
import { apiKey, bearer } from '../../identity/kinds.js';

/** Raw result shape we consume from the AgentCore identity client. */
export interface AgentCoreOauthResponse {
  readonly accessToken?: string;
  readonly authorizationUrl?: string;
  /** Correlates a 3LO consent round-trip. The real service reports this as
   *  `sessionUri`; the SDK shim renames it here. */
  readonly sessionId?: string;
  /** Unix seconds. **AgentCore does not report one** —
   *  `GetResourceOauth2TokenResponse` has no expiry field, so this is only ever
   *  populated by an injected `_client` that knows one from elsewhere. */
  readonly expiresAt?: number;
}

/** The minimal, operation-semantic surface the adapter calls — `GetResourceOauth2Token`
 *  and (for per-user workload scoping) `GetWorkloadAccessTokenForUserId`.
 *  `createIdentityClient` maps the real SDK's `send(new Command(...))` onto this;
 *  tests and custom integrations inject a fake via `_client`. */
export interface AgentCoreIdentityClientLike {
  getResourceOauth2Token(input: {
    readonly resourceCredentialProviderName: string;
    readonly scopes: readonly string[];
    readonly oauth2Flow: 'M2M' | 'USER_FEDERATION' | 'ON_BEHALF_OF_TOKEN_EXCHANGE';
    readonly forceAuthentication: boolean;
    readonly workloadIdentityToken?: string;
  }): Promise<AgentCoreOauthResponse>;
  /** Optional — required only when `workloadName` is configured. Exchanges
   *  (workloadName, userId) for a USER-SCOPED workload access token; AgentCore
   *  keys its token vault + 3LO grants per (workload, user). */
  getWorkloadAccessTokenForUserId?(input: {
    readonly workloadName: string;
    readonly userId: string;
  }): Promise<{ readonly workloadAccessToken?: string }>;
  /** Optional — required only when a request carries `userToken`. Exchanges the
   *  user's OWN IdP-issued JWT for a workload access token representing both the
   *  workload and the user. Same answer shape as the by-userId exchange, which
   *  is why both feed the same `workloadIdentityToken`. */
  getWorkloadAccessTokenForJWT?(input: {
    readonly workloadName: string;
    readonly userToken: string;
  }): Promise<{ readonly workloadAccessToken?: string }>;
  /** Optional — required only for services named in `apiKeyServices`. AgentCore
   *  keeps API keys in the same vault as OAuth tokens, behind a different
   *  operation, so this is a sibling of `getResourceOauth2Token` rather than a
   *  mode of it. */
  getResourceApiKey?(input: {
    readonly resourceCredentialProviderName: string;
    /** REQUIRED on the wire — `GetResourceApiKeyRequest` declares it non-optional. */
    readonly workloadIdentityToken: string;
  }): Promise<{ readonly apiKey?: string }>;
  /** Optional — required only by {@link completeAgentCoreAuthorization}. Tells
   *  AgentCore that the person behind `sessionId` finished consenting, which is
   *  what releases the token into the vault for the next vend. */
  completeResourceTokenAuth?(input: {
    readonly sessionId: string;
    readonly userToken?: string;
    readonly userId?: string;
  }): Promise<void>;
}

export interface AgentCoreIdentityOptions {
  readonly region?: string;
  /** The agent's workload access token (AgentCore Runtime injects one in-container;
   *  supply it explicitly when running elsewhere). Used as-is unless a per-user
   *  workload token is resolved (see `workloadName`). */
  readonly workloadIdentityToken?: string;
  /** The AgentCore workload identity name — the OPT-IN for per-request identity
   *  scoping, and the one option BOTH exchanges need. When set, a `mode: 'user'`
   *  request resolves a per-user workload access token before vending — from
   *  `req.userToken` via `GetWorkloadAccessTokenForJWT` when the user's own JWT
   *  arrived, otherwise from `req.identity` via `GetWorkloadAccessTokenForUserId`
   *  — so AgentCore's token vault + 3LO grants are keyed per (workload, user)
   *  instead of per workload. Omit → today's static-token behavior. */
  readonly workloadName?: string;
  /**
   * Refuse a `mode: 'user'` request that carries no `req.userToken` (9.12.0),
   * instead of falling back to the by-userId exchange or the static token.
   *
   * The opt-in for a deployment where the front door really does authenticate
   * every person — an AgentCore Runtime behind JWT inbound auth, an API gateway
   * that validates a bearer token. There, a delegated request with no proof
   * attached is a wiring bug, and the failure it causes without this flag is the
   * quiet kind: a token gets vended, the call succeeds, and it was scoped to the
   * agent (or to a user id the agent asserted) rather than to the person.
   *
   * `mode: 'machine'` is never affected — M2M is the workload's own identity and
   * has no user to prove.
   */
  readonly requireUserToken?: boolean;
  /** Map `req.identity` → the AgentCore `userId`. Default: `identity.principal`.
   *  `tenant` has no native AgentCore field — encode it here if you need
   *  tenant-scoped vault entries (e.g. ``({ tenant, principal }) =>
   *  tenant && principal ? `${tenant}:${principal}` : principal``). Return
   *  `undefined` to skip per-user scoping for that request. */
  readonly userIdFor?: (identity: {
    readonly principal?: string;
    readonly tenant?: string;
  }) => string | undefined;
  /**
   * How a `mode: 'user'` request gets its token (9.66.0). Default `'consent'`.
   *
   *   `'consent'`  — AgentCore's `USER_FEDERATION`. If the vault has no grant
   *                  for this (workload, user), the result is an
   *                  `authorization-required` with a URL to send the person to.
   *                  They approve once; later calls return a token directly.
   *   `'exchange'` — AgentCore's `ON_BEHALF_OF_TOKEN_EXCHANGE`. The person's
   *                  own login is TRADED for a scoped downstream token, with no
   *                  consent screen at any point.
   *
   * `'exchange'` is not simply the nicer one. It works only where the
   * downstream provider was configured for it (an on-behalf-of exchange grant
   * on the credential provider) and where trading the user's session for
   * downstream access is a decision your organisation has already made — the
   * consent screen is what asks the person, and this flow is the deployment
   * saying it does not need to. Choose it deliberately.
   *
   * `mode: 'machine'` is unaffected: M2M has no user to act for.
   */
  readonly userFlow?: 'consent' | 'exchange';
  /**
   * Services whose credential is an API KEY, not an OAuth token (9.66.0).
   *
   * AgentCore's vault holds both kinds behind two different operations, and the
   * provider NAME alone does not say which — so a request for a service named
   * here is vended with `GetResourceApiKey` and comes back as an
   * {@link apiKey} credential. Everything else takes the OAuth path.
   *
   * There is no auto-detection on purpose: guessing would mean calling one
   * operation, catching a failure, and retrying with the other, which turns a
   * configuration mistake into two round-trips and an ambiguous error.
   */
  readonly apiKeyServices?: readonly string[];
  /** Header an API-key credential is sent in. Default `'x-api-key'`. */
  readonly apiKeyHeader?: string;
  /** Stable provider id (default 'agentcore-identity'). */
  readonly id?: string;
  /** Test seam — inject a client implementing {@link AgentCoreIdentityClientLike}.
   *  Bypasses the SDK entirely; the field mapping below is then yours. */
  readonly _client?: AgentCoreIdentityClientLike;
  /** @internal Test injection — the AWS SDK module, to exercise the real shim
   *  (`send(new Command(...))`) with a fake SDK. */
  readonly _sdk?: BedrockAgentCoreIdentitySdkModule;
}

/** The slice of `@aws-sdk/client-bedrock-agentcore` this shim touches. */
export interface BedrockAgentCoreIdentitySdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly GetResourceOauth2TokenCommand?: new (input: unknown) => unknown;
  readonly GetWorkloadAccessTokenForUserIdCommand?: new (input: unknown) => unknown;
  readonly GetWorkloadAccessTokenForJWTCommand?: new (input: unknown) => unknown;
  readonly GetResourceApiKeyCommand?: new (input: unknown) => unknown;
  readonly CompleteResourceTokenAuthCommand?: new (input: unknown) => unknown;
}

/**
 * Re-raise a failed SDK call **without its text** (9.12.0).
 *
 * Every input this adapter sends is a secret: the user's JWT goes into
 * `GetWorkloadAccessTokenForJWT`, a workload access token goes into
 * `GetResourceOauth2Token`. AWS clients report transport and validation
 * failures by echoing request detail into the message — which is how a live
 * user session ends up in a string that this library then hands to the LLM as
 * a tool result and emits on `agentfootprint.credential.failed`. One echo, and
 * it is in the conversation, the commit log, the narrative and every sink.
 *
 * So the text does not come through. What does is the part that is both safe
 * and actionable: which operation failed, the exception's NAME (AWS models
 * them — `AccessDeniedException`, `ResourceNotFoundException`,
 * `ThrottlingException`, `UnauthorizedException`, `ValidationException`) and
 * the HTTP status. That is the same trade the Vault adapter makes, and it is
 * the same reason.
 *
 * **The original is deliberately not attached as `cause`.** A cause travels
 * with the error into every serializer that walks own properties, which would
 * undo the whole of this in one `JSON.stringify`.
 *
 * An injected `_client` never reaches here: it owns its own mapping, and its
 * own secrecy with it — the same law this file already states for field names.
 */
function sdkFailure(command: string, err: unknown): Error {
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  const name = typeof e?.name === 'string' && e.name.length > 0 ? e.name : 'an unnamed failure';
  const status = e?.$metadata?.httpStatusCode;
  return new Error(
    `agentCoreIdentity: ${command} failed — ${name}` +
      (typeof status === 'number' ? ` (HTTP ${status})` : '') +
      ".\n  The SDK's own message is withheld: this request carried a token, and AWS clients " +
      'echo request detail into failure text. Check CloudWatch for the full exception.',
  );
}

/**
 * Read the exchanged workload token, or refuse **by shape**.
 *
 * Shared by both exchanges so there is one refusal to read and one rule about
 * what may be said: field NAMES and a count, never a value. Every field of a
 * token-exchange response is a token, and this message travels to the model, to
 * `agentfootprint.credential.failed` and to every log sink attached to it. An
 * operator debugging a malformed answer needs to know which fields came back,
 * which is exactly the part that is safe to print.
 */
function requireWorkloadAccessToken(
  response: { readonly workloadAccessToken?: string } | null | undefined,
  operation: string,
): string {
  const token = response?.workloadAccessToken;
  if (typeof token === 'string' && token.length > 0) return token;
  const fields = response && typeof response === 'object' ? Object.keys(response) : [];
  throw new Error(
    `agentCoreIdentity: ${operation} returned no usable workloadAccessToken, so there is no ` +
      'user-scoped workload token to vend with — refusing rather than falling back to a ' +
      'workload-level one.\n' +
      `  The response carried ${fields.length} field(s)` +
      (fields.length > 0 ? `: ${fields.join(', ')}.` : '.') +
      '\n  Values are withheld on purpose: every field of a token-exchange response is a secret.',
  );
}

/**
 * Map {@link AgentCoreIdentityClientLike} onto the real SDK commands.
 *
 * Two things this function owns, and nothing else does:
 *   1. **The command form.** `send(new Command(input))` — see the module header
 *      for why a method on the Client is not an option.
 *   2. **The wire field names.** `GetResourceOauth2Token` answers with
 *      `sessionUri`, not `sessionId`, and never reports an expiry. Reading
 *      `sessionId` off the response (as this adapter did through 9.3.0) yields
 *      `undefined` forever, which arrived at the consumer as an empty
 *      `sessionId` on every consent round-trip. An injected `_client` is
 *      somebody else's mapping and is left alone.
 */
function createIdentityClient(options: AgentCoreIdentityOptions): AgentCoreIdentityClientLike {
  let mod: BedrockAgentCoreIdentitySdkModule;
  if (options._sdk) {
    mod = options._sdk;
  } else {
    try {
      // Lazy peer-dep: only loaded when no _client/_sdk is injected and getCredential runs.
      mod = lazyRequire<BedrockAgentCoreIdentitySdkModule>('@aws-sdk/client-bedrock-agentcore');
    } catch {
      throw new Error(
        'agentCoreIdentity requires the `@aws-sdk/client-bedrock-agentcore` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-agentcore\n' +
          '  Or pass `_client` for a pre-built or mock client.',
      );
    }
  }
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      'agentCoreIdentity: `@aws-sdk/client-bedrock-agentcore` is installed but ' +
        '`BedrockAgentCoreClient` was not found. Update the SDK.',
    );
  }
  const sdk = new mod.BedrockAgentCoreClient({ ...(options.region && { region: options.region }) });

  const send = async (
    Ctor: (new (i: unknown) => unknown) | undefined,
    name: string,
    input: unknown,
  ): Promise<unknown> => {
    if (!Ctor) {
      throw new Error(
        `agentCoreIdentity: \`@aws-sdk/client-bedrock-agentcore\` is missing ${name}. ` +
          'Upgrade the SDK, or pass `_client` with your own mapping.',
      );
    }
    try {
      return await sdk.send(new Ctor(input));
    } catch (err) {
      throw sdkFailure(name, err);
    }
  };

  return {
    async getResourceOauth2Token(input) {
      if (!input.workloadIdentityToken) {
        // `workloadIdentityToken` is REQUIRED on GetResourceOauth2TokenRequest.
        // Sending the call without one buys an opaque ValidationException from
        // AWS; saying so here names the two ways to supply it instead.
        throw new Error(
          'agentCoreIdentity: GetResourceOauth2Token requires a workload identity token, and ' +
            'none was available for this request.\n' +
            '  Inside AgentCore Runtime the container is given one — read it and pass it as ' +
            '`workloadIdentityToken`.\n' +
            '  Elsewhere, configure `workloadName` so a per-user token is resolved via ' +
            'GetWorkloadAccessTokenForUserId, or pass `workloadIdentityToken` yourself.',
        );
      }
      const r = (await send(
        mod.GetResourceOauth2TokenCommand,
        'GetResourceOauth2TokenCommand',
        input,
      )) as {
        accessToken?: string;
        authorizationUrl?: string;
        sessionUri?: string;
      } | null;
      return {
        ...(r?.accessToken !== undefined && { accessToken: r.accessToken }),
        ...(r?.authorizationUrl !== undefined && { authorizationUrl: r.authorizationUrl }),
        // The service's correlation handle for a 3LO round-trip is `sessionUri`.
        ...(r?.sessionUri !== undefined && { sessionId: r.sessionUri }),
      };
    },
    // ── The two workload-token exchanges ──────────────────────────────
    //
    // Both answer `{ workloadAccessToken }` and nothing else, so unlike
    // `getResourceOauth2Token` above there is no field to rename — and both
    // hand the response back AS RECEIVED rather than narrowed to that one
    // field. That is deliberate: when the field is missing,
    // `requireWorkloadAccessToken` refuses by describing the response's SHAPE,
    // and a shim that had already thrown the other field names away would leave
    // it describing an empty object — the least useful message available, on
    // the one path where the operator has nothing else to go on.
    async getWorkloadAccessTokenForUserId(input) {
      return (
        ((await send(
          mod.GetWorkloadAccessTokenForUserIdCommand,
          'GetWorkloadAccessTokenForUserIdCommand',
          input,
        )) as { workloadAccessToken?: string } | null) ?? {}
      );
    },
    async getResourceApiKey(input) {
      const r = (await send(mod.GetResourceApiKeyCommand, 'GetResourceApiKeyCommand', input)) as {
        apiKey?: string;
      } | null;
      return { ...(r?.apiKey !== undefined && { apiKey: r.apiKey }) };
    },
    async completeResourceTokenAuth(input) {
      // `CompleteResourceTokenAuthRequest` is `{ sessionUri, userIdentifier }`,
      // where userIdentifier is a UNION with exactly one member set — the
      // person's own token, or the id the agent asserts for them. Success is an
      // empty 200, so there is nothing to map back.
      await send(mod.CompleteResourceTokenAuthCommand, 'CompleteResourceTokenAuthCommand', {
        sessionUri: input.sessionId,
        userIdentifier:
          input.userToken !== undefined ? { userToken: input.userToken } : { userId: input.userId },
      });
    },
    async getWorkloadAccessTokenForJWT(input) {
      // `GetWorkloadAccessTokenForJWTRequest` is `{ workloadName, userToken }`,
      // both required, and the response is `{ workloadAccessToken }` — verified
      // against a real install of @aws-sdk/client-bedrock-agentcore before this
      // shipped, the same way the code-interpreter shapes were. `userToken` is
      // the SDK's own name for the user's IdP-issued OAuth2 token, so the
      // adapter and the wire agree without a rename.
      return (
        ((await send(
          mod.GetWorkloadAccessTokenForJWTCommand,
          'GetWorkloadAccessTokenForJWTCommand',
          input,
        )) as { workloadAccessToken?: string } | null) ?? {}
      );
    },
  };
}

function resolveClient(options: AgentCoreIdentityOptions): AgentCoreIdentityClientLike {
  // An injected client is used as-is — that seam is how a custom integration
  // (or a test double) replaces the whole mapping.
  if (options._client) return options._client;
  return createIdentityClient(options);
}

const defaultUserIdFor = (identity: { readonly principal?: string }): string | undefined =>
  identity.principal;

/** Build a {@link CredentialProvider} backed by AWS Bedrock AgentCore Identity. */
export function agentCoreIdentity(options: AgentCoreIdentityOptions = {}): CredentialProvider {
  let client: AgentCoreIdentityClientLike | undefined;
  const getClient = (): AgentCoreIdentityClientLike => (client ??= resolveClient(options));
  const userIdFor = options.userIdFor ?? defaultUserIdFor;

  // Per-request identity forwarding (workload identity scoping) — see module
  // header for the ladder and why both exchanges answer the same question.
  // `GetResourceOauth2Token` has no user field; the user is bound at
  // workload-token acquisition, so a `mode: 'user'` request resolves a
  // USER-SCOPED workload token first and vends with that. Both exchanges
  // require `workloadName` (the opt-in); with neither engaged the static
  // `workloadIdentityToken` flows unchanged (pre-forwarding behavior).
  const resolveWorkloadToken = async (req: CredentialRequest): Promise<string | undefined> => {
    const delegated = req.mode === 'user';

    if (req.userToken !== undefined) {
      if (!delegated) {
        // A user's signed token on a request that asks for the WORKLOAD's own
        // identity. Vending M2M while holding somebody's proof is the exact
        // silent downgrade this whole path exists to close, so it is named
        // rather than resolved one way or the other.
        throw new Error(
          "agentCoreIdentity: a `userToken` arrived on a `mode: 'machine'` request. M2M is the " +
            "workload's own identity — there is no user to act on behalf of, and the token " +
            "would be ignored.\n  Declare `mode: 'user'` to exchange it, or drop the token.",
        );
      }
      if (!options.workloadName) {
        throw new Error(
          'agentCoreIdentity: a `userToken` arrived but no `workloadName` is configured, so ' +
            'there is nothing to exchange it against — and vending at workload level would ' +
            "hand back a token scoped to the AGENT while holding the user's proof.\n" +
            '  Configure `workloadName` (your AgentCore workload identity), or stop sending ' +
            '`userToken`.',
        );
      }
      const c = getClient();
      if (typeof c.getWorkloadAccessTokenForJWT !== 'function') {
        // The SDK-backed client always implements this, so reaching here means
        // an injected `_client` that does not.
        throw new Error(
          'agentCoreIdentity: a `userToken` arrived, but the injected `_client` has no ' +
            'getWorkloadAccessTokenForJWT. Implement it, or stop sending `userToken`.',
        );
      }
      return requireWorkloadAccessToken(
        await c.getWorkloadAccessTokenForJWT({
          workloadName: options.workloadName,
          userToken: req.userToken,
        }),
        'GetWorkloadAccessTokenForJWT',
      );
    }

    if (options.requireUserToken === true && delegated) {
      // The deployment said every delegated request is authenticated. One that
      // is not is a wiring bug, and the only alternative to saying so is to
      // vend something weaker and let it succeed.
      throw new Error(
        "agentCoreIdentity: `requireUserToken` is set, but this `mode: 'user'` request for " +
          `'${req.service}' carried no \`userToken\`.\n` +
          "  Pass the caller's own IdP token as `getCredential({ …, userToken })` — inside " +
          'AgentCore Runtime behind JWT inbound auth it is the bearer token the front door ' +
          'validated.\n' +
          '  Or drop `requireUserToken` to fall back to the by-userId exchange.',
      );
    }

    const userId = delegated && req.identity !== undefined ? userIdFor(req.identity) : undefined;
    if (userId === undefined || !options.workloadName) return options.workloadIdentityToken;

    const c = getClient();
    if (typeof c.getWorkloadAccessTokenForUserId !== 'function') {
      // Explicit config must not silently degrade to workload-level tokens.
      // The SDK-backed client always implements this, so reaching here means an
      // injected `_client` that does not.
      throw new Error(
        'agentCoreIdentity: `workloadName` is configured for per-user workload scoping, ' +
          'but the injected `_client` has no getWorkloadAccessTokenForUserId. Implement it, ' +
          'or drop `workloadName` to vend with the static `workloadIdentityToken`.',
      );
    }
    return requireWorkloadAccessToken(
      await c.getWorkloadAccessTokenForUserId({ workloadName: options.workloadName, userId }),
      'GetWorkloadAccessTokenForUserId',
    );
  };

  const userFlow = options.userFlow ?? 'consent';
  const apiKeyServices = new Set(options.apiKeyServices ?? []);
  const apiKeyHeader = options.apiKeyHeader ?? 'x-api-key';

  return {
    id: options.id ?? 'agentcore-identity',
    async getCredential(req: CredentialRequest): Promise<CredentialResult> {
      const workloadIdentityToken = await resolveWorkloadToken(req);

      // An API-key service never touches the OAuth path: different operation,
      // different credential kind, and no consent round-trip exists for it.
      if (apiKeyServices.has(req.service)) {
        const c = getClient();
        if (!c.getResourceApiKey) {
          throw new Error(
            `agentCoreIdentity: '${req.service}' is listed in \`apiKeyServices\` but the ` +
              'injected `_client` has no getResourceApiKey. Implement it, or drop the service ' +
              'from the list to vend it as OAuth.',
          );
        }
        if (!workloadIdentityToken) {
          // Required on `GetResourceApiKeyRequest`, exactly as on the OAuth
          // call — verified against the real SDK's types, not assumed. Sending
          // without one buys an opaque ValidationException; this names the two
          // ways to supply it instead.
          throw new Error(
            `agentCoreIdentity: GetResourceApiKey for '${req.service}' requires a workload ` +
              'identity token, and none was available for this request.\n' +
              '  Inside AgentCore Runtime the container is given one — pass it as ' +
              '`workloadIdentityToken`.\n' +
              '  Elsewhere, configure `workloadName` so a per-user token is resolved first.',
          );
        }
        const keyRes = await c.getResourceApiKey({
          resourceCredentialProviderName: req.service,
          workloadIdentityToken,
        });
        if (!keyRes.apiKey) {
          throw new Error(
            `agentCoreIdentity: GetResourceApiKey for '${req.service}' returned no key.`,
          );
        }
        return { status: 'issued', credential: apiKey(keyRes.apiKey, apiKeyHeader) };
      }

      const res = await getClient().getResourceOauth2Token({
        resourceCredentialProviderName: req.service,
        scopes: req.scopes ?? [],
        oauth2Flow:
          req.mode === 'user'
            ? userFlow === 'exchange'
              ? 'ON_BEHALF_OF_TOKEN_EXCHANGE'
              : 'USER_FEDERATION'
            : 'M2M',
        forceAuthentication: req.forceReauth ?? false,
        ...(workloadIdentityToken && { workloadIdentityToken }),
      });

      if (res.accessToken) {
        // AgentCore Identity vends OAuth access tokens → a bearer credential.
        return {
          status: 'issued',
          credential: bearer(res.accessToken),
          ...(res.expiresAt !== undefined && { expiresAt: res.expiresAt }),
        };
      }
      if (res.authorizationUrl) {
        return {
          status: 'authorization-required',
          authorizationUrl: res.authorizationUrl,
          sessionId: res.sessionId ?? '',
        };
      }
      throw new Error(
        `agentCoreIdentity: GetResourceOauth2Token for '${req.service}' returned neither ` +
          'an access token nor an authorization URL.',
      );
    },
  };
}

/** Connection options for {@link completeAgentCoreAuthorization}. */
export interface CompleteAgentCoreAuthorizationOptions {
  /** The 3LO round-trip this completes — the `sessionId` from the
   *  `authorization-required` result the agent returned. */
  readonly sessionId: string;
  /** The person's own IdP-issued JWT, if your callback has it. Preferred: it is
   *  the artifact their provider signed. */
  readonly userToken?: string;
  /** The user id you asserted for them, when no JWT is available. Exactly one
   *  of `userToken` / `userId` is required. */
  readonly userId?: string;
  readonly region?: string;
  /** Test seam — same client surface the provider uses. */
  readonly _client?: AgentCoreIdentityClientLike;
  /** @internal Test injection — the AWS SDK module. */
  readonly _sdk?: BedrockAgentCoreIdentitySdkModule;
}

/**
 * Tell AgentCore the person finished consenting, so the token lands in the vault.
 *
 * ── Where this runs, and why it is not a provider method ─────────────────────
 * A 3LO consent has three actors and two processes. The agent asks for a
 * credential and gets back `authorization-required` with a URL and a session
 * id; the PERSON opens that URL in their browser and approves; AgentCore then
 * redirects their browser to a callback route **your web app** owns. That route
 * is where this belongs — a different process from the agent run, often a
 * different service — so it takes its own connection options rather than
 * pretending to be a method on a provider that route has never seen.
 *
 * Your route's job before calling this is the part nobody else can do: confirm
 * the browser session really belongs to the user you are about to name. This
 * function is the handshake, not the authentication.
 *
 * ── After it returns ─────────────────────────────────────────────────────────
 * Nothing is handed back — success is an empty acknowledgement. The token now
 * exists in the vault for that (workload, user), and the way to obtain it is to
 * run the agent's request again: the next `getCredential` for that service
 * returns `issued` where the last one returned `authorization-required`. In
 * agentfootprint terms the consent is a PAUSE, and this is what makes the
 * resume succeed.
 *
 * The authorization URL and its session are short-lived (AWS documents ten
 * minutes) — a person who wanders off has to start the consent again, and the
 * refusal you get is AgentCore's, not this adapter's.
 *
 * @example  An Express-style callback route
 *   app.get('/oauth/callback', async (req, res) => {
 *     const user = await requireSignedInUser(req);   // yours, and load-bearing
 *     await completeAgentCoreAuthorization({
 *       sessionId: String(req.query.session),
 *       userId: user.id,
 *       region: 'us-east-1',
 *     });
 *     res.send('Approved — you can return to the assistant.');
 *   });
 */
export async function completeAgentCoreAuthorization(
  options: CompleteAgentCoreAuthorizationOptions,
): Promise<void> {
  if (!options.sessionId) {
    throw new Error(
      'completeAgentCoreAuthorization: `sessionId` is required — it is the `sessionId` from ' +
        'the `authorization-required` result that started this consent.',
    );
  }
  if ((options.userToken === undefined) === (options.userId === undefined)) {
    // Both or neither. Naming a person twice is ambiguous; naming them zero
    // times completes a consent for nobody.
    throw new Error(
      'completeAgentCoreAuthorization: pass exactly one of `userToken` (the person’s own JWT, ' +
        'preferred) or `userId` (an id you assert for them).',
    );
  }
  const client =
    options._client ??
    createIdentityClient({
      ...(options.region !== undefined && { region: options.region }),
      ...(options._sdk !== undefined && { _sdk: options._sdk }),
    });
  if (!client.completeResourceTokenAuth) {
    throw new Error(
      'completeAgentCoreAuthorization: the injected `_client` has no ' +
        'completeResourceTokenAuth. Implement it, or omit `_client` to use the SDK.',
    );
  }
  await client.completeResourceTokenAuth({
    sessionId: options.sessionId,
    ...(options.userToken !== undefined && { userToken: options.userToken }),
    ...(options.userId !== undefined && { userId: options.userId }),
  });
}
