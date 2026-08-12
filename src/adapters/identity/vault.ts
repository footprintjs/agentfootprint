/**
 * vaultCredentials — a {@link CredentialProvider} over a HashiCorp-Vault-compatible
 * KV v2 secret store, spoken as plain HTTP.
 *
 *   import { vaultCredentials } from 'agentfootprint/security';
 *
 *   const credentials = vaultCredentials({
 *     address: 'https://vault.internal:8200',   // https, or say `allowHttp` out loud
 *     mount: 'secret',                          // KV v2 mount, default 'secret'
 *     paths: { github: 'ci/github' },           // service → path INSIDE the mount
 *   });                                         // token: VAULT_TOKEN, or `token`
 *
 * Zero dependencies and no SDK: one `GET` per resolution through the runtime's
 * own `fetch`. Vault's HTTP API is small, stable and the thing every
 * Vault-compatible store (OpenBao, and the Vault-API modes of several managed
 * stores) implements — so the adapter that speaks HTTP works against more
 * backends than the adapter that imports one vendor's client.
 *
 * ## V1 is deliberately one shape, and says so by name
 *
 * | Axis | V1 | Anything else |
 * |---|---|---|
 * | Auth | a **token** (`token` option, else `VAULT_TOKEN`) | AppRole / Kubernetes / JWT / AWS IAM login are **refused by name**, naming the option that would carry them |
 * | Secret engine | **KV v2** (`<mount>/data/<path>`, the `data.data` envelope) | a KV v1 mount is refused by name once the response shape gives it away |
 * | Leases / renewal | **none** — every `getCredential` re-reads the secret | a lease-aware provider is a different object, and the library's model since 9.7.0 is re-resolve-per-call |
 *
 * That is not modesty, it is the honest edge: an auth method the author cannot
 * exercise against a real cluster would be a guess wearing an adapter's clothes.
 * Each refusal names the option it would arrive on, so "tell us your auth shape"
 * is a field report rather than an issue title.
 *
 * ## Field → credential kind
 *
 * A KV v2 read returns `{ data: { data: { …your fields… }, metadata: {…} } }`.
 * The inner object is mapped to a {@link Credential} by the FIRST rule that
 * matches, so a secret written the ordinary way needs no configuration:
 *
 * | Fields present | Becomes | Header it applies |
 * |---|---|---|
 * | `token` | `bearer(token)` | `authorization: Bearer …` |
 * | `api_key` \| `apiKey` \| `key` | `apiKey(value, header ?? 'x-api-key')` | that header |
 * | `username` + `password` | `basic(username, password)` | `authorization: Basic …` |
 * | `headers` (an object of strings) | `headers(map)` | all of them |
 *
 * A secret matching none of them is refused — naming the PATH and the four
 * shapes, never the secret. `toCredential` is the seam for a shop whose fields
 * are named otherwise; it sees the secret and returns a `Credential`, and
 * returning `undefined` falls back to the table above.
 *
 * ## Secrecy (the 8.6.0 two-clause law, applied here)
 *
 * A thrown message reaches the model as a tool result AND rides
 * `agentfootprint.credential.failed`. So every error this adapter raises names
 * **the service, the path and the HTTP status, and nothing from the response
 * body or the token**. Nothing here logs, and no secret value, no `X-Vault-Token`
 * header and no field name from the payload appears in any message it can throw
 * — pinned by a grep-shaped test over every failure path. The credential it
 * returns hides its own secret fields (non-enumerable) and carries `toHeaders`,
 * so `structuredClone` rejects it and it cannot enter tracked scope by accident.
 *
 * @example Dev → prod is the same two lines
 * ```ts
 * // dev
 * const credentials = staticTokens({ github: 'ghp_dev_xxx' });
 * // prod — the tool code does not change
 * const credentials = vaultCredentials({ address: process.env.VAULT_ADDR! });
 * Agent.create({ provider, model, credentials }).build();
 * ```
 */

import type {
  Credential,
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
} from '../../identity/types.js';
import { apiKey, basic, bearer, headers } from '../../identity/kinds.js';

// ─── Public options ──────────────────────────────────────────────────

/** The base options every form shares. */
interface VaultCredentialsBase {
  /** Vault's base URL, e.g. `https://vault.internal:8200` — **required**, and
   *  **https** unless {@link VaultCredentialsBase.allowHttp} says otherwise. No
   *  `VAULT_ADDR` fallback: an agent that silently picks up an address from the
   *  environment is an agent that reads a different vault when the environment
   *  changes under it. Name it. */
  readonly address: string;
  /** The Vault token. Falls back to `VAULT_TOKEN` (the variable every Vault
   *  tool already sets). This is a secret: it is sent as `X-Vault-Token` and
   *  appears in no message this adapter can throw. */
  readonly token?: string;
  /** Auth method. **`'token'` is the only one V1 implements.** Anything else is
   *  refused at construction, by name, with what it would take — see
   *  {@link vaultCredentials}. */
  readonly auth?: 'token';
  /** KV v2 mount point. Default `'secret'` (Vault's own default for the KV v2
   *  engine). The read URL is `<address>/v1/<mount>/data/<path>`. */
  readonly mount?: string;
  /** Vault Enterprise / HCP namespace, sent as `X-Vault-Namespace`. Omit for
   *  open-source Vault and OpenBao, which have no namespaces. */
  readonly namespace?: string;
  /** Map the secret's fields to a {@link Credential} yourself. Returns
   *  `undefined` to fall back to the built-in table (`token` / `api_key` /
   *  `username`+`password` / `headers`). The seam for a shop whose field names
   *  are its own — and the reason this adapter does not need an option per
   *  spelling. **Never log or return the fields from here**; they are the
   *  secret. */
  readonly toCredential?: (
    secret: Readonly<Record<string, unknown>>,
    service: string,
  ) => Credential | undefined;
  /** Header name for the `api_key` shape when the secret does not carry its own
   *  `header` field. Default `'x-api-key'`. */
  readonly apiKeyHeader?: string;
  /** Request timeout in ms. Default 5000 — a credential resolution sits in
   *  front of a tool call, so a hung vault must fail rather than hang a run. */
  readonly timeoutMs?: number;
  /** Allow a plain-`http://` address. **Refused unless you set this**, because
   *  the Vault token travels in a request header: over plaintext HTTP, anyone
   *  on the path reads a token that can usually read every secret it can reach.
   *  Set it only for a loopback dev server (`http://127.0.0.1:8200`). */
  readonly allowHttp?: boolean;
  /** Stable provider id (default `'vault'`). Shows up in "which provider vended
   *  this". */
  readonly id?: string;
  /** Test seam — inject `fetch`. Bypasses the network entirely. */
  readonly _fetch?: typeof fetch;
}

/**
 * How a `service` becomes a path inside the mount. Three arms, and they
 * EXCLUDE each other — two spellings of one rule can disagree, so the type
 * refuses the pair and so does the constructor.
 */
type VaultPathMapping =
  | {
      /** `service → path inside the mount`, the {@link staticTokens} shape one
       *  level up: the same literal map, holding a path instead of a token. An
       *  unknown service is refused by name, listing the known ones. */
      readonly paths: Readonly<Record<string, string>>;
      readonly resolve?: never;
    }
  | {
      /** `service → path`, computed. Return `undefined` to refuse a service.
       *  For the convention-driven shop: ``(s) => `agents/${s}` ``. */
      readonly resolve: (service: string) => string | undefined;
      readonly paths?: never;
    }
  | {
      /** Neither: the **service id IS the path** under the mount, so
       *  `service: 'github'` reads `<mount>/data/github`. */
      readonly paths?: undefined;
      readonly resolve?: undefined;
    };

export type VaultCredentialsOptions = VaultCredentialsBase & VaultPathMapping;

/** Auth methods a caller may ask for, and the option that would carry each one
 *  when it is built. Naming them is the teaching: a refusal that says "not
 *  supported" ends the conversation; one that says what it would take starts a
 *  field report. */
const UNBUILT_AUTH_METHODS: Readonly<Record<string, string>> = {
  approle: '`roleId` + `secretId` (Vault `auth/approle/login`)',
  kubernetes: '`role` + the projected service-account token path (`auth/kubernetes/login`)',
  jwt: '`role` + a signed JWT/OIDC assertion (`auth/jwt/login`)',
  oidc: '`role` + a signed JWT/OIDC assertion (`auth/jwt/login`)',
  aws: '`role` + a signed STS identity document (`auth/aws/login`)',
  cert: 'a client certificate + key, which is a TLS-agent decision, not a header',
  userpass: '`username` + `password` (`auth/userpass/login`)',
  ldap: '`username` + `password` (`auth/ldap/login`)',
};

// ─── Public factory ──────────────────────────────────────────────────

/**
 * Build a {@link CredentialProvider} that reads KV v2 secrets from a
 * Vault-compatible store. See {@link VaultCredentialsOptions} for the
 * per-option contract and this module's docstring for the V1 boundary.
 */
export function vaultCredentials(options: VaultCredentialsOptions): CredentialProvider {
  const id = options.id ?? 'vault';

  if (!options.address || typeof options.address !== 'string' || options.address.trim() === '') {
    throw new TypeError(
      `${id}: \`address\` is required — the Vault base URL, e.g. ` +
        `'https://vault.internal:8200'. It is not read from VAULT_ADDR on purpose: ` +
        `an agent that picks its vault out of the environment reads a different vault ` +
        `when the environment changes under it.`,
    );
  }

  const address = options.address.replace(/\/+$/, '');
  if (!/^https:\/\//i.test(address)) {
    if (!/^http:\/\//i.test(address)) {
      throw new TypeError(`${id}: \`address\` must be an http(s) URL (got '${address}').`);
    }
    if (!options.allowHttp) {
      throw new TypeError(
        `${id}: refusing a plain-http address ('${address}'). The Vault token travels in ` +
          `the \`X-Vault-Token\` request header, so over plaintext HTTP anyone on the path ` +
          `reads a token that can usually read every secret it can reach — and a leaked ` +
          `read token is not revoked by rotating one secret. Use https, or set ` +
          `\`allowHttp: true\` deliberately for a loopback dev server.`,
      );
    }
  }

  if (options.auth !== undefined && options.auth !== 'token') {
    const asked = String(options.auth).toLowerCase();
    const wouldTake = UNBUILT_AUTH_METHODS[asked];
    throw new TypeError(
      `${id}: \`auth: '${String(options.auth)}'\` is not built. V1 authenticates with a ` +
        `TOKEN only — \`token\`, or the \`VAULT_TOKEN\` environment variable.` +
        (wouldTake
          ? ` ${asked} login would arrive on ${wouldTake}, plus a re-login when the ` +
            `returned lease expires.`
          : ` A login method would need its own credentials and a re-login on lease expiry.`) +
        ` This is field-gated rather than guessed: tell us your auth shape (which method, ` +
        `which mount path, which lease behaviour) and it gets built against a real cluster ` +
        `instead of an API document. Until then, exchange it yourself and pass the ` +
        `resulting token as \`token\`.`,
    );
  }

  if (options.paths && options.resolve) {
    throw new TypeError(
      `${id}: pass \`paths\` OR \`resolve\`, not both — two spellings of one rule can ` +
        `disagree, and the one that loses would do so silently. Use \`paths\` for a fixed ` +
        `map, \`resolve\` when the path is computed from the service id.`,
    );
  }

  const token = options.token ?? readEnv('VAULT_TOKEN');
  if (!token) {
    throw new TypeError(
      `${id}: no Vault token. Pass \`token\`, or set the VAULT_TOKEN environment variable. ` +
        `(V1 authenticates with a token only — see \`auth\`.)`,
    );
  }

  const mount = trimSlashes(options.mount ?? 'secret');
  const timeoutMs = options.timeoutMs ?? 5000;
  const apiKeyHeader = options.apiKeyHeader ?? 'x-api-key';
  const doFetch = options._fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  /** service → path inside the mount, by whichever arm was configured. */
  function pathFor(service: string): string {
    if (options.paths) {
      const mapped = options.paths[service];
      if (mapped === undefined) {
        throw new Error(
          `${id}: no secret path configured for service '${service}'. ` +
            `Known services: ${Object.keys(options.paths).join(', ') || '(none)'}.`,
        );
      }
      return trimSlashes(mapped);
    }
    if (options.resolve) {
      const mapped = options.resolve(service);
      if (!mapped) {
        throw new Error(
          `${id}: \`resolve('${service}')\` returned no path, so this service has no secret ` +
            `to read. Return a path inside the '${mount}' mount, or configure the service ` +
            `elsewhere.`,
        );
      }
      return trimSlashes(mapped);
    }
    // No mapping configured: the service id IS the path.
    return trimSlashes(service);
  }

  return {
    id,
    async getCredential(req: CredentialRequest): Promise<CredentialResult> {
      const secretPath = pathFor(req.service);
      // KV v2's read shape. `/data/` is the v2 API segment, not part of your
      // path — `secret/ci/github` in the UI is `secret/data/ci/github` here.
      const url = `${address}/v1/${mount}/data/${secretPath}`;
      const where = `'${mount}/${secretPath}'`;

      const secret = await readSecret({
        url,
        where,
        id,
        service: req.service,
        token,
        namespace: options.namespace,
        timeoutMs,
        doFetch,
      });

      const custom = options.toCredential?.(secret, req.service);
      if (custom) return { status: 'issued', credential: custom };

      const credential = mapFieldsToCredential(secret, apiKeyHeader);
      if (!credential) {
        throw new Error(
          `${id}: the secret at ${where} has none of the field shapes this adapter reads — ` +
            `\`token\`, \`api_key\`/\`apiKey\`/\`key\`, \`username\`+\`password\`, or ` +
            `\`headers\`. (The fields it DOES have are deliberately not named here: an ` +
            `error message reaches the model and the credential.failed event.) Rewrite the ` +
            `secret in one of those shapes, or pass \`toCredential\` to map your own.`,
        );
      }
      // No `expiresAt`: a KV v2 secret has no lease, so there is no expiry to
      // report and inventing one would be worse than absence. V1 re-reads on
      // every call, which is the library's model since 9.7.0.
      return { status: 'issued', credential };
    },
  };
}

// ─── The one HTTP call ───────────────────────────────────────────────

interface ReadSecretArgs {
  readonly url: string;
  /** `'<mount>/<path>'` — the ONE piece of request detail errors may name. */
  readonly where: string;
  readonly id: string;
  readonly service: string;
  readonly token: string;
  readonly namespace?: string;
  readonly timeoutMs: number;
  readonly doFetch: typeof fetch;
}

/**
 * GET one KV v2 secret and return its inner `data.data` object.
 *
 * Every throw below names the provider id, the service, the mount path and (for
 * an HTTP failure) the status. None of them can name the token, a response body
 * or a field of the secret — that restraint IS the contract, because this
 * message becomes a tool result the model reads and a `credential.failed`
 * payload every observer receives.
 */
async function readSecret(args: ReadSecretArgs): Promise<Readonly<Record<string, unknown>>> {
  const { id, where, service } = args;

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await args.doFetch(args.url, {
      method: 'GET',
      headers: {
        'X-Vault-Token': args.token,
        accept: 'application/json',
        ...(args.namespace && { 'X-Vault-Namespace': args.namespace }),
      },
      signal: AbortSignal.timeout(args.timeoutMs),
    });
  } catch (err) {
    // Transport failure: DNS, TLS, refused connection, timeout. The cause is
    // safe to name — it describes the socket, never the payload — but it is
    // re-wrapped rather than rethrown so no fetch implementation can smuggle
    // request headers into the text.
    throw new Error(
      `${id}: could not reach Vault for service '${service}' (${where}): ` +
        `${transportReason(err)}.`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `${id}: Vault returned ${res.status} reading ${where} for service '${service}'` +
        `${statusHint(res.status)}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(
      `${id}: Vault's response for ${where} was not JSON (status ${res.status}). ` +
        `Check that \`address\` points at Vault's API and not at a proxy or login page.`,
    );
  }

  const outer = (body as { data?: unknown } | null)?.data;
  if (!isRecord(outer)) {
    throw new Error(
      `${id}: no secret data at ${where} (status ${res.status}). ` +
        `Check the path exists in the KV v2 mount.`,
    );
  }
  const inner = (outer as { data?: unknown }).data;
  if (!isRecord(inner)) {
    // A v1 mount answers with the fields directly under `data`, with no inner
    // envelope. That is the one cheap, unambiguous v1 tell, so it is named
    // rather than guessed at.
    throw new Error(
      `${id}: the response for ${where} is not KV v2 shaped (no \`data.data\` envelope). ` +
        `This adapter reads KV **v2** only, which is why the URL carries the \`/data/\` ` +
        `segment. If '${where.split('/')[0]?.replace(/'/g, '') || 'that mount'}' is a KV v1 ` +
        `mount, upgrade it (\`vault kv enable-versioning\`) or mount v2 — or tell us, and ` +
        `\`kvVersion\` is the option a v1 reader would arrive on.`,
    );
  }
  return inner;
}

/** A short, payload-free reason for a transport failure. */
function transportReason(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'the request timed out';
    return err.name || 'network error';
  }
  return 'network error';
}

/** What a status usually means here. Static text keyed by number — it cannot
 *  echo a response, because it never reads one. */
function statusHint(status: number): string {
  if (status === 403) {
    return '. The token is valid but its policy does not allow reading that path.';
  }
  if (status === 401) return '. The token is missing, expired or revoked.';
  if (status === 404) {
    return (
      '. Either the path does not exist, or the mount is not a KV v2 mount ' +
      '(the read URL carries the v2 `/data/` segment).'
    );
  }
  if (status === 503) return '. Vault is sealed or standby.';
  return '.';
}

// ─── Field → kind ────────────────────────────────────────────────────

/**
 * The built-in field table, first match wins. Deliberately small: four shapes
 * cover what secrets actually hold, and `toCredential` covers the rest without
 * this function growing an option per spelling.
 */
function mapFieldsToCredential(
  secret: Readonly<Record<string, unknown>>,
  defaultApiKeyHeader: string,
): Credential | undefined {
  const token = str(secret.token);
  if (token) return bearer(token);

  const key = str(secret.api_key) ?? str(secret.apiKey) ?? str(secret.key);
  if (key) return apiKey(key, str(secret.header) ?? defaultApiKeyHeader);

  const username = str(secret.username);
  const password = str(secret.password);
  if (username && password) return basic(username, password);

  const map = secret.headers;
  if (isRecord(map)) {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      const s = str(v);
      if (s) flat[k] = s;
    }
    if (Object.keys(flat).length > 0) return headers(flat);
  }

  return undefined;
}

// ─── Small helpers ───────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A non-empty string, or undefined. Numbers are NOT coerced: a secret field
 *  that is not a string is not a credential this adapter knows how to apply. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, '');
}

/** Read one environment variable, in any runtime. Absent `process` (a browser,
 *  a worker) simply means no fallback. */
function readEnv(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return p?.env?.[name];
}
