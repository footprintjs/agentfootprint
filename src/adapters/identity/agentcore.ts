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
 *   - a returned access token → `{ status: 'issued', credential: bearer(token) }`
 *   - a returned auth URL     → `{ status: 'authorization-required' }` (3LO consent)
 *
 * The token vault + refresh-token handling live in AgentCore, so repeat calls
 * usually return a token directly (no consent round-trip).
 *
 * **Per-request identity forwarding (workload identity scoping).**
 * `GetResourceOauth2Token` carries NO user/tenant field — in AgentCore the
 * user identity is bound EARLIER, at workload-token acquisition:
 * `GetWorkloadAccessTokenForUserId(workloadName, userId)` returns a workload
 * access token scoped to that user, and AgentCore keys its token vault + 3LO
 * grants per (workload, user). So this adapter forwards `req.identity` (the
 * `runIdentity` that the agent threads through `getCredential`) by resolving a
 * per-user workload token first, then vending with it. Engages only when ALL of:
 *   - `req.mode === 'user'` (USER_FEDERATION — M2M is the workload's own identity),
 *   - a userId derives from `req.identity` (default `identity.principal`;
 *     override via `userIdFor`), and
 *   - `options.workloadName` is configured (the opt-in).
 * Otherwise the static `options.workloadIdentityToken` flows exactly as before.
 * `tenant` has no native AgentCore field and is NOT forwarded by default —
 * tenant isolation derives from the workload identity itself (per-tenant
 * workloads), or encode it via `userIdFor` (e.g. `${tenant}:${principal}`).
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
import { bearer } from '../../identity/kinds.js';

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
    readonly oauth2Flow: 'M2M' | 'USER_FEDERATION';
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
}

export interface AgentCoreIdentityOptions {
  readonly region?: string;
  /** The agent's workload access token (AgentCore Runtime injects one in-container;
   *  supply it explicitly when running elsewhere). Used as-is unless a per-user
   *  workload token is resolved (see `workloadName`). */
  readonly workloadIdentityToken?: string;
  /** The AgentCore workload identity name — the OPT-IN for per-request identity
   *  scoping. When set, `mode: 'user'` requests carrying `req.identity` resolve a
   *  per-user workload access token via `GetWorkloadAccessTokenForUserId(workloadName,
   *  userId)` before vending, so AgentCore's token vault + 3LO grants are keyed per
   *  (workload, user) instead of per workload. Omit → today's static-token behavior. */
  readonly workloadName?: string;
  /** Map `req.identity` → the AgentCore `userId`. Default: `identity.principal`.
   *  `tenant` has no native AgentCore field — encode it here if you need
   *  tenant-scoped vault entries (e.g. ``({ tenant, principal }) =>
   *  tenant && principal ? `${tenant}:${principal}` : principal``). Return
   *  `undefined` to skip per-user scoping for that request. */
  readonly userIdFor?: (identity: {
    readonly principal?: string;
    readonly tenant?: string;
  }) => string | undefined;
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
    return sdk.send(new Ctor(input));
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
    async getWorkloadAccessTokenForUserId(input) {
      const r = (await send(
        mod.GetWorkloadAccessTokenForUserIdCommand,
        'GetWorkloadAccessTokenForUserIdCommand',
        input,
      )) as { workloadAccessToken?: string } | null;
      return {
        ...(r?.workloadAccessToken !== undefined && {
          workloadAccessToken: r.workloadAccessToken,
        }),
      };
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
  // header. `GetResourceOauth2Token` has no user field; the user is bound at
  // workload-token acquisition, so a `mode: 'user'` request carrying an
  // identity exchanges (workloadName, userId) for a USER-SCOPED workload token
  // and vends with that. Requires `workloadName` (the opt-in); without it the
  // static `workloadIdentityToken` flows unchanged (pre-forwarding behavior).
  const resolveWorkloadToken = async (req: CredentialRequest): Promise<string | undefined> => {
    const userId =
      req.mode === 'user' && req.identity !== undefined ? userIdFor(req.identity) : undefined;
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
    const res = await c.getWorkloadAccessTokenForUserId({
      workloadName: options.workloadName,
      userId,
    });
    if (!res.workloadAccessToken) {
      throw new Error(
        'agentCoreIdentity: GetWorkloadAccessTokenForUserId returned no workloadAccessToken ' +
          'for per-user scoped vending.',
      );
    }
    return res.workloadAccessToken;
  };

  return {
    id: options.id ?? 'agentcore-identity',
    async getCredential(req: CredentialRequest): Promise<CredentialResult> {
      const workloadIdentityToken = await resolveWorkloadToken(req);
      const res = await getClient().getResourceOauth2Token({
        resourceCredentialProviderName: req.service,
        scopes: req.scopes ?? [],
        oauth2Flow: req.mode === 'user' ? 'USER_FEDERATION' : 'M2M',
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
