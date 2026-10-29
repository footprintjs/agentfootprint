/**
 * plan — what one client is opened from, resolved before anything opens, and
 * the context its tool definitions belong to.
 *
 * Pattern: a pure resolution step + two hashes.
 * Role:    § 6.1–6.2 of the design. A client is opened from a PLAN: the
 *          transport the factory returns for this identity, resolved at that
 *          moment and kept unchanged for the client's life. The plan's
 *          `configHash` is SHA-256 over a canonical encoding of the transport's
 *          comparable data — the pool name; the transport kind and URL; header
 *          names and a digest of their values; a gateway's service, scopes,
 *          mode and credential provider id; stdio's command, args and working
 *          directory; the transport's own stated `settings`; `resultMode` and
 *          `clientInfo`. A function (a `fetch`, an AWS client) cannot be
 *          compared: the app's `configuration` name covers it.
 *
 * The definitions CONTEXT is the binding a tool is listed under:
 *
 *   - per client (the default): `pc:<configHash>` — the client's own list;
 *   - shared, when the app's `share` names both a configuration and an
 *     authorization: `sh:<sha256(configHash, configuration, authorization,
 *     tenant)>`. The tenant is always in it: the app's names widen sharing
 *     across principals, never across tenants.
 *
 * The transport is resolved once, when a client opens; the context is not. The
 * app's names can move — a policy version in `authorization` — so the pool asks
 * `share` again at every listing, every call and every send gate
 * (`contextFor`), over the client's own `configHash`: a conversation that
 * already has a client follows a new name as a new conversation would.
 *
 * Neither hash leaves the process; the app's names are hashed and never kept.
 */

import { canonicalJson } from '../../lib/canonicalJson.js';
import { sha256Hex } from '../../lib/sha256.js';
import type { ClientPort, PooledClientSeam } from '../clientPort.js';
import type { McpClient, McpClientOptions, McpTransport } from '../types.js';
import type { PoolKey } from './identityKey.js';
import type { McpPoolShareContext, PoolSettings } from './options.js';

/** What a client is opened from. */
export interface ClientPlan {
  readonly transport: McpTransport;
  readonly configHash: string;
  /** The definitions context: `pc:<configHash>` or `sh:<context>`. */
  readonly context: string;
  /** True when the app's sharing contract applies to this conversation. */
  readonly shared: boolean;
}

/** An opened client: the ordinary `McpClient`, and the port back (`clientPort.ts`). */
export interface OpenedClient {
  readonly client: McpClient;
  readonly port: ClientPort;
}

/**
 * How the pool opens one client. The real path is `openPooledClient`; a test
 * injects its own (the `_open` seam).
 */
export type PoolClientOpener = (
  options: McpClientOptions,
  seam: PooledClientSeam,
) => Promise<OpenedClient>;

/**
 * The plan for `key`: the transport the factory returns now, and the context
 * its definitions belong to.
 *
 * @throws what the transport factory or `share` throws, and a TypeError when
 *   `share` answers with anything but two names or `undefined` — the caller
 *   refuses the open with `init-failed`, the error as its `cause`
 */
export function resolvePlan(settings: PoolSettings, key: PoolKey): ClientPlan {
  const transport = settings.transport(key.identity);
  if (
    transport === null ||
    typeof transport !== 'object' ||
    typeof transport.transport !== 'string'
  ) {
    throw new TypeError(
      `mcpClientPool[${settings.name}]: the \`transport\` function returned something that is not an MCP transport.`,
    );
  }
  const configHash = configHashOf(settings, transport);
  return { transport, configHash, ...contextFor(settings, key, configHash) };
}

/**
 * The definitions context `key` belongs to now, for a client opened with
 * `configHash`: the app's `share` asked again.
 *
 * @throws what `share` throws, and a TypeError when it answers with anything
 *   but two names or `undefined`
 */
export function contextFor(
  settings: PoolSettings,
  key: PoolKey,
  configHash: string,
): { readonly context: string; readonly shared: boolean } {
  const names = shareOf(settings, key);
  if (names === undefined) return { context: `pc:${configHash}`, shared: false };
  const context = sha256Hex(
    canonicalJson({
      configHash,
      configuration: names.configuration,
      authorization: names.authorization,
      tenant: key.tenant,
    }),
  );
  return { context: `sh:${context}`, shared: true };
}

/** The app's two names for this conversation, or `undefined` for a list of its own. */
function shareOf(settings: PoolSettings, key: PoolKey): McpPoolShareContext | undefined {
  if (settings.share === undefined) return undefined;
  const names: unknown = settings.share(key.identity);
  if (names === undefined) return undefined;
  if (
    names !== null &&
    typeof names === 'object' &&
    typeof (names as McpPoolShareContext).configuration === 'string' &&
    typeof (names as McpPoolShareContext).authorization === 'string'
  ) {
    const { configuration, authorization } = names as McpPoolShareContext;
    return { configuration, authorization };
  }
  throw new TypeError(
    `mcpClientPool[${settings.name}]: \`definitions.share\` must return { configuration, authorization } ` +
      '(two strings) or undefined, synchronously.',
  );
}

/** SHA-256 over the transport's comparable data (see the module note). */
export function configHashOf(settings: PoolSettings, transport: McpTransport): string {
  return sha256Hex(
    canonicalJson({
      pool: settings.name,
      transport: comparableOf(transport),
      resultMode: settings.client.resultMode ?? null,
      clientInfo: settings.client.clientInfo ?? null,
    }),
  );
}

/** The comparable part of a transport: data only, functions left out. */
function comparableOf(transport: McpTransport): Record<string, unknown> {
  if (transport.transport === 'stdio') {
    return {
      kind: 'stdio',
      command: transport.command,
      args: [...(transport.args ?? [])],
      cwd: transport.cwd ?? null,
    };
  }
  const headers = headersOf(transport.headers);
  if (transport.transport === 'gateway') {
    return {
      kind: 'gateway',
      url: transport.url,
      headers,
      service: transport.service,
      scopes: [...(transport.scopes ?? [])],
      mode: transport.mode ?? null,
      credentials: transport.credentials?.id ?? null,
    };
  }
  return {
    kind: 'http',
    url: transport.url,
    headers,
    settings: transport.settings ?? null,
  };
}

/** Header names, and a digest of their values — never the values themselves. */
function headersOf(headers: Readonly<Record<string, string>> | undefined): Record<string, unknown> {
  if (headers === undefined) return { names: [], digest: null };
  const lowered = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { names: Object.keys(lowered).sort(), digest: sha256Hex(canonicalJson(lowered)) };
}
