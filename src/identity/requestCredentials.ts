/**
 * requestCredentials — a {@link CredentialProvider} fed from the INCOMING
 * REQUEST: the credential a tool uses is the one this run's caller sent.
 *
 * ```ts
 * import { requestCredentials, requestContext, decodedWith } from 'agentfootprint/security';
 *
 * // Once, at boot — no secret in here:
 * const credentials = requestCredentials({
 *   services: {
 *     crm: 'crmToken',                                         // bearer, as sent
 *     billing: { secret: 'billingKey', as: asApiKey('x-api-key') },
 *     mcp: { secret: 'mcpToken', as: decodedWith((raw) => decrypt(raw)) },
 *   },
 * });
 * const agent = Agent.create({ provider, credentials }).tool(crmTool).build();
 *
 * // Per request:
 * await agent.run({ message }, { request: requestContext({ secrets: { crmToken, mcpToken } }) });
 * ```
 *
 * A tool declares `needs: { credential: 'crm' }` and reads `ctx.credential`,
 * exactly as with any other provider. Nothing about the tool changes.
 *
 * ── Interface → adapter → strategies ────────────────────────────────────────
 * The interface is the `CredentialProvider` port. This adapter reads the
 * secret named for the service from the request the call belongs to
 * (`CredentialRequest.request`, filled by the framework). A strategy turns the
 * raw value into a `Credential`: {@link asBearer} (the default),
 * {@link asApiKey}, or {@link decodedWith} for a value that must be decrypted
 * or exchanged first.
 *
 * ── Fails closed, by name ───────────────────────────────────────────────────
 * Every refusal is a {@link RequestCredentialError} naming the SERVICE and the
 * secret's NAME — never a value, and never a strategy's own error text (a
 * decrypt library may quote its input). A thrown message reaches the model as
 * the tool result and rides `agentfootprint.credential.failed`.
 *   - no request on the call (a run started without one, a mount no run
 *     reaches, a connection-level caller) → `'no-request'`;
 *   - the request does not carry the secret → `'missing'`;
 *   - a service this provider was not told about → `'unknown-service'`;
 *   - the strategy threw or returned no credential → `'undecodable'`.
 * There is no fallback: a missing per-request credential is never served from
 * another request, a default, or the process.
 *
 * Pattern: Adapter (port) + Strategy (raw value → Credential).
 */

import type {
  Credential,
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
} from './types.js';
import { apiKey, bearer } from './kinds.js';
import { requestSecretOf } from './requestContext.js';

/** Raw request value → the credential a tool applies. May be async (decrypt, exchange). */
export type RequestCredentialStrategy = (raw: string) => Credential | Promise<Credential>;

/** Where a service's credential comes from in the request, and how it is read. */
export interface RequestCredentialSource {
  /** The secret's name in `requestContext({ secrets })`. */
  readonly secret: string;
  /** How the raw value becomes a credential. Default {@link asBearer}. */
  readonly as?: RequestCredentialStrategy;
}

/** What {@link requestCredentials} takes. */
export interface RequestCredentialsOptions {
  /** Optional id (defaults to `'request-credentials'`). */
  readonly id?: string;
  /**
   * Service id (what a tool's `needs.credential` names) → its source. A string
   * is the secret's name, read as a bearer token.
   */
  readonly services: Readonly<Record<string, string | RequestCredentialSource>>;
}

/** Why a request credential was refused. */
export type RequestCredentialRefusal = 'no-request' | 'missing' | 'unknown-service' | 'undecodable';

/**
 * A request credential that could not be served. Its message names the
 * service and the secret's name; it never carries a value or a strategy's
 * own error.
 */
export class RequestCredentialError extends Error {
  readonly code = 'ERR_REQUEST_CREDENTIAL' as const;

  constructor(
    readonly reason: RequestCredentialRefusal,
    readonly service: string,
    message: string,
  ) {
    super(message);
    this.name = 'RequestCredentialError';
  }
}

/** The raw value, as a bearer token (`Authorization: Bearer …`). The default. */
export function asBearer(): RequestCredentialStrategy {
  return (raw) => bearer(raw);
}

/** The raw value, as an API key in one header (default `x-api-key`). */
export function asApiKey(headerName?: string): RequestCredentialStrategy {
  return (raw) => apiKey(raw, headerName);
}

/**
 * Decode the raw value first — decrypt an encrypted per-request token,
 * exchange it — then read the result with `then` (default {@link asBearer}).
 * `decode` may return the plain value or a finished `Credential`. Whatever it
 * throws is replaced by an `'undecodable'` refusal that quotes nothing.
 */
export function decodedWith(
  decode: (raw: string) => string | Credential | Promise<string | Credential>,
  then: RequestCredentialStrategy = asBearer(),
): RequestCredentialStrategy {
  return async (raw) => {
    const decoded = await decode(raw);
    return typeof decoded === 'string' ? then(decoded) : decoded;
  };
}

/**
 * Build the provider. Configuration is checked here, at boot: an empty
 * service map, an empty secret name or a strategy that is not a function is
 * refused by name.
 *
 * @throws TypeError on a malformed `services` map.
 */
export function requestCredentials(options: RequestCredentialsOptions): CredentialProvider {
  const sources = readSources(options?.services);
  return {
    id: options.id ?? 'request-credentials',
    async getCredential(req: CredentialRequest): Promise<CredentialResult> {
      const service = req.service;
      const source = Object.hasOwn(sources, service) ? sources[service] : undefined;
      if (source === undefined) {
        throw new RequestCredentialError(
          'unknown-service',
          service,
          `requestCredentials: no request credential is declared for service '${service}'.`,
        );
      }
      if (req.request === undefined) {
        throw new RequestCredentialError(
          'no-request',
          service,
          `requestCredentials: service '${service}' takes its credential from the incoming ` +
            'request, and this call carries none — pass `request: requestContext({ secrets })` ' +
            'to the run. A credential is never borrowed from another request.',
        );
      }
      const raw = requestSecretOf(req.request, source.secret);
      if (raw === undefined) {
        throw new RequestCredentialError(
          'missing',
          service,
          `requestCredentials: the request carries no '${source.secret}' secret for service ` +
            `'${service}'.`,
        );
      }
      let credential: unknown;
      try {
        credential = await source.as(raw);
      } catch {
        credential = undefined;
      }
      if (!isCredential(credential)) {
        throw new RequestCredentialError(
          'undecodable',
          service,
          `requestCredentials: the '${source.secret}' secret for service '${service}' could ` +
            'not be read as a credential.',
        );
      }
      return { status: 'issued', credential };
    },
  };
}

interface ReadSource {
  readonly secret: string;
  readonly as: RequestCredentialStrategy;
}

function readSources(services: unknown): Readonly<Record<string, ReadSource>> {
  if (services === null || typeof services !== 'object' || Array.isArray(services)) {
    throw new TypeError('requestCredentials: `services` must be an object of service → source.');
  }
  const out: Record<string, ReadSource> = Object.create(null);
  const names = Object.keys(services);
  if (names.length === 0) {
    throw new TypeError('requestCredentials: `services` names no service.');
  }
  for (const service of names) {
    const entry = (services as Record<string, unknown>)[service];
    const secret = typeof entry === 'string' ? entry : (entry as { secret?: unknown })?.secret;
    const as = typeof entry === 'string' ? undefined : (entry as { as?: unknown })?.as;
    if (typeof secret !== 'string' || secret === '') {
      throw new TypeError(
        `requestCredentials: service '${service}' must name its secret (a non-empty string).`,
      );
    }
    if (as !== undefined && typeof as !== 'function') {
      throw new TypeError(
        `requestCredentials: service '${service}': \`as\` must be a strategy function.`,
      );
    }
    out[service] = { secret, as: (as as RequestCredentialStrategy | undefined) ?? asBearer() };
  }
  return out;
}

function isCredential(value: unknown): value is Credential {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Credential).kind === 'string' &&
    typeof (value as Credential).toHeaders === 'function'
  );
}
