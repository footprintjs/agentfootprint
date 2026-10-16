/**
 * requestContext — the INCOMING REQUEST's secrets, sealed for one run.
 *
 * A host that receives a per-request credential (an encrypted token in a
 * header, a session-bound key) seals it here and hands the handle to the run:
 *
 * ```ts
 * const request = requestContext({ secrets: { mcpToken: req.headers['x-mcp-token'] } });
 * await agent.run({ message }, { request });
 * ```
 *
 * ── Why a sealed handle and not a plain object ──────────────────────────────
 * The run's input, its options and its state all travel: input and state into
 * the commit log, the recorders and every exporter; options into whatever a
 * host logs. A plain `{ mcpToken: '…' }` would ride all of them. The handle
 * holds NOTHING an enumeration, `JSON.stringify`, `structuredClone` or an
 * inspector can reach — the values live in a module-private `WeakMap` keyed by
 * the handle, and only {@link requestSecretOf} (internal, never on a door)
 * reads them. So the handle can sit in an options bag, be logged by accident,
 * or be copied, and nothing secret moves with it.
 *
 * ── Who reads it ─────────────────────────────────────────────────────────────
 * Only a credential provider, through `CredentialRequest.request`, which the
 * framework fills from the run the call belongs to (`bindRequest`). The model
 * never sees it, no stage writes it to scope, and a tool reaches what it
 * vends only as `ctx.credential`.
 *
 * ── One request, one run ─────────────────────────────────────────────────────
 * The framework decides WHICH handle a call carries — the agent's own run, or
 * the run a composition opened for its members (`core/memberRun.ts`). A call
 * with no run that carries a request gets none: a request credential then
 * fails closed (`requestCredentials`), and is never borrowed from another run.
 *
 * Pattern: sealed value object (module-private WeakMap). Role: identity, run input.
 */

import type { CredentialProvider, CredentialRequest } from './types.js';

/** The sealed values, keyed by handle. Module-private: nothing else can read them. */
const sealed = new WeakMap<object, ReadonlyMap<string, string>>();

/** What {@link requestContext} takes. */
export interface RequestContextOptions {
  /**
   * The request's secrets, by name — `{ mcpToken: '<from the header>' }`.
   * Each value must be a non-empty string; names are compared exactly.
   */
  readonly secrets: Readonly<Record<string, string>>;
}

/**
 * The incoming request's secrets, sealed. Opaque: it has no readable fields,
 * serializes as a fixed placeholder, and is recognised by the framework only
 * when {@link requestContext} built it.
 */
export interface RequestContext {
  /** Brand — a value built anywhere else is refused, never read. */
  readonly __requestContext: true;
}

const PLACEHOLDER = '[request context]';

/**
 * Seal an incoming request's secrets for one run. Pass the result as
 * `run(input, { request })` (or `resume(…, { request })`); a credential
 * provider built by `requestCredentials` reads it there.
 *
 * @throws TypeError when `secrets` is not a plain object of non-empty strings.
 */
export function requestContext(options: RequestContextOptions): RequestContext {
  const secrets = (options as { readonly secrets?: unknown } | undefined)?.secrets;
  if (secrets === null || typeof secrets !== 'object' || Array.isArray(secrets)) {
    throw new TypeError('requestContext: `secrets` must be an object of name → string.');
  }
  const values = new Map<string, string>();
  for (const name of Object.keys(secrets)) {
    const value = (secrets as Record<string, unknown>)[name];
    if (name === '') throw new TypeError('requestContext: a secret name must not be empty.');
    // The NAME is safe to say; the value never is.
    if (typeof value !== 'string' || value === '') {
      throw new TypeError(
        `requestContext: secret '${name}' must be a non-empty string — an absent value is ` +
          'left out, never passed empty.',
      );
    }
    values.set(name, value);
  }
  const handle = Object.create(handleProto) as RequestContext;
  Object.freeze(handle);
  sealed.set(handle, values);
  return handle;
}

/**
 * The handle's prototype — every reader that might print or copy it gets the
 * placeholder. No own properties, so `Object.keys`, a spread or
 * `structuredClone` yields `{}`.
 */
const handleProto: object = Object.freeze({
  toJSON: () => PLACEHOLDER,
  toString: () => PLACEHOLDER,
  [Symbol.toStringTag]: 'RequestContext',
  [Symbol.for('nodejs.util.inspect.custom')]: () => PLACEHOLDER,
});

/** Whether `value` is a handle {@link requestContext} built. */
export function isRequestContext(value: unknown): value is RequestContext {
  return typeof value === 'object' && value !== null && sealed.has(value);
}

/**
 * Refuse a `request` that {@link requestContext} did not build — at the door
 * the caller used, before anything moves. A plain object would carry its
 * values wherever the options travel.
 *
 * @throws TypeError naming the door.
 */
export function assertRequestContext(value: unknown, door: string): void {
  if (value === undefined || isRequestContext(value)) return;
  throw new TypeError(
    `${door}: \`request\` must be built by requestContext({ secrets }) — a plain object is ` +
      'refused, because its values would travel wherever these options are logged or copied.',
  );
}

/**
 * The secret a sealed request holds under `name`, or `undefined`.
 *
 * @internal Never re-exported on a door. The only reader is a credential
 * provider in this folder, which turns it into a `Credential` for one call.
 */
export function requestSecretOf(request: unknown, name: string): string | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  return sealed.get(request)?.get(name);
}

/**
 * The provider a call of ONE run is handed: a `getCredential` for `service` —
 * the service the calling tool DECLARES in its `needs` — carries that run's
 * request, and only that run's. A request the caller put on the request
 * itself is always replaced (or removed), so a tool cannot present another
 * run's handle through `ctx.credentials`; and a call for any OTHER service
 * carries no request, so a tool cannot pull a request credential it never
 * declared. `service` undefined → no call carries a request.
 *
 * Every other field passes through untouched; the provider's `id` is kept.
 *
 * @internal The framework's binding; not on a door.
 */
export function bindRequest(
  provider: CredentialProvider,
  request: RequestContext | undefined,
  service: string | undefined,
): CredentialProvider {
  return {
    id: provider.id,
    getCredential(req: CredentialRequest) {
      const { request: _presented, ...rest } = req;
      void _presented;
      const carries = request !== undefined && service !== undefined && req.service === service;
      return provider.getCredential(carries ? { ...rest, request } : rest);
    },
  };
}
