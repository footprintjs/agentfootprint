/**
 * connectionRefusals — the two arms of `mcpClient` refuse to be mixed, at
 * CONSTRUCTION, in words that name where the behaviour went.
 *
 * ── Why refuse rather than ignore ────────────────────────────────────────────
 * `mcpClient({ connection })` hands over a client somebody else built, so this
 * library builds no transport on that arm — and every option consumed INSIDE a
 * transport therefore has nothing to act on. `retryOnThrottle` is the sharp
 * one: it is ON by default, it is consumed by `retryingFetch` around the
 * transport's `fetch`, and accepting it here would leave a caller holding an
 * option that NAMES a behaviour which no longer happens. A knob that lies about
 * what it does is worse than one that is absent, so these throw.
 *
 * The type union refuses the same combinations at compile time
 * (`McpConnectionOptions` declares each of them `?: undefined`). This is the
 * runtime half, and it is not redundant: excess-property checking does not
 * survive a spread, and JavaScript callers have no compiler at all.
 *
 * Pattern: pure guard. Role: Layer-3 tool integration.
 */

import type { McpClientOptions, McpConnectionOptions } from './types.js';

/** The three methods this library calls on a connection. Nothing else. */
const CONNECTION_METHODS = ['listTools', 'callTool', 'close'] as const;

/**
 * Refuse a mixed or malformed options object before anything connects.
 *
 * @param opts what the caller passed, before any defaulting
 * @param name the client's logical name, so a multi-server app knows which one
 * @throws naming the two options that cannot travel together, or the member the
 *   connection is missing
 */
export function refuseConflictingOptions(
  opts: McpClientOptions | McpConnectionOptions,
  name: string,
): void {
  const at = `mcpClient[${name}]`;
  // Read through a permissive view on purpose. The union already narrows these
  // combinations away at compile time, so narrowing here would leave the guard
  // reasoning about a shape it exists precisely to disbelieve — an object built
  // by a spread, or by JavaScript.
  const given = opts as unknown as Readonly<Record<string, unknown>>;

  if (given['connection'] === undefined) {
    if (given['transport'] === undefined && given['_client'] === undefined) {
      throw new Error(
        `${at}: nothing to connect to. Pass \`transport\` (the library builds the connection) ` +
          'or `connection` (a client you connected yourself).',
      );
    }
    return;
  }

  // From here on the caller chose the `connection` arm.
  for (const [option, moved] of BUILT_BY_THE_TRANSPORT) {
    if (given[option] !== undefined) {
      throw new Error(
        `${at}: \`connection\` and \`${option}\` cannot travel together. ` +
          `A connection you built yourself carries its own transport, and \`${option}\` is ` +
          `consumed inside the transport this library did not build. ${moved}`,
      );
    }
  }
  assertConnection(given['connection'], at);
}

/**
 * The options that only exist because the library builds the transport, each
 * paired with the sentence naming where that behaviour moved to. Ordered so the
 * most surprising loss — throttle retry, which is ON by default — is named
 * first when a caller passes several.
 */
const BUILT_BY_THE_TRANSPORT: ReadonlyArray<
  readonly [keyof McpClientOptions & keyof McpConnectionOptions, string]
> = [
  [
    'retryOnThrottle',
    'Wrap your own `fetch` with `retryingFetch(yourFetch, options)` (exported from ' +
      '`agentfootprint/providers`) and hand THAT to your transport — it is the same ' +
      'implementation, applied where you build it.',
  ],
  [
    'clientInfo',
    'Pass it to the SDK `Client` constructor instead: `new Client(clientInfo, { capabilities: {} })`.',
  ],
  [
    'transport',
    'Drop one of the two: `transport` asks the library to connect, `connection` says it already is.',
  ],
  [
    'sdk',
    '`sdk` exists so the library can build the transport without its Node loader; ' +
      'on this arm you have already built it.',
  ],
  [
    '_client',
    '`_client` is the same idea as `connection` and predates it — pass `connection` alone.',
  ],
];

/**
 * A connection is only a connection if it can be called.
 *
 * This catches the near-miss people actually make: handing over the TRANSPORT
 * rather than the client. A transport has none of these three methods, and
 * without this check it fails on the first `tools()`, one stack frame deep
 * inside the SDK.
 *
 * The OTHER near-miss — a `Client` that was constructed but never `connect()`ed
 * — cannot be caught here, because it has all three methods. It is named in the
 * message anyway, since it produces the same "my connection does not work" and
 * the SDK's own "Not connected" is the thing to look for.
 */
function assertConnection(connection: unknown, at: string): void {
  const members = (connection ?? {}) as Readonly<Record<string, unknown>>;
  for (const method of CONNECTION_METHODS) {
    if (typeof members[method] !== 'function') {
      throw new Error(
        `${at}: \`connection\` has no \`${method}()\`. It must be an MCP client that is ` +
          'already connected, and the likely mistake is passing the TRANSPORT instead of the ' +
          'client. (A `new Client(...)` you never awaited `connect()` on passes this check ' +
          'and fails later with the SDK\'s own "Not connected".)',
      );
    }
  }
}
