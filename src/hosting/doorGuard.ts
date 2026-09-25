/**
 * hosting/doorGuard — what a request has to be before any handler sees it.
 *
 *   const guard = doorGuard({ name: 'auth', allowedHosts: ['neo.corp.example'] });
 *   const refusal = guard.check(req);          // an IncomingMessage works as-is
 *   if (refusal) return answer(refusal.status, refusal.message, refusal.code);
 *
 * ── The threat, in one paragraph ────────────────────────────────────────────
 * A door with no verifier, reachable only inside a company network, looks safe
 * because the network is the fence. It is not: every person inside the fence
 * runs a browser, and every web page they open can make that browser send
 * requests to the door FROM INSIDE. Three ways, all live before this file:
 *
 *   1. **A forged request (CSRF).** A page on any site can make the browser
 *      POST a JSON-shaped body as `text/plain` (or as a form, or with no
 *      content type at all) without asking the server first — a CORS "simple"
 *      request. The door parsed it as JSON and ran a turn: model budget spent,
 *      tools called, a conversation stored. The attacker cannot read the reply;
 *      they do not need to.
 *   2. **DNS rebinding.** A page on an attacker's domain re-points its OWN name
 *      at the door's address. The browser now treats the attacker's page as
 *      same-origin with the door, so it may send anything and READ the answer.
 *   3. **A cross-site WebSocket.** A WebSocket is not bound by the same-origin
 *      policy at all; any page can open one, and only the server can say no.
 *
 * ── The rules, one owner ────────────────────────────────────────────────────
 * `check()` judges a request that CHANGES something — every method but GET,
 * HEAD and OPTIONS, plus every WebSocket upgrade (a GET that opens a channel):
 *
 *   - **Host** (with `allowedHosts` set, or defaulted to the loopback names on
 *     a loopback bind; judged on EVERY method): a name this door was not
 *     configured for is refused, 421. First, because under rebinding the other
 *     two checks pass — the Host header, which no page can set, is the one
 *     fact that still names the attacker. `X-Forwarded-Host` is never read for
 *     it: a rebinding page is same-origin and may set that header itself.
 *   - **Origin**: a browser request from a page this door does not allow is
 *     refused, 403 — including `Origin: null`. A request WITHOUT an Origin is a
 *     script or a server (browsers always send one on these requests) and is
 *     not judged by it; that is what keeps every non-browser client working.
 *   - **Fetch metadata**, as defence in depth: a request the browser itself
 *     marked `Sec-Fetch-Site: cross-site` is refused (403) unless its Origin is
 *     one `allowedOrigins` LISTS — so a proxy that strips `Origin` but forwards
 *     `Sec-Fetch-*` still cannot let a forged request through. For a WebSocket
 *     handshake these two are the whole defence: the browser API cannot set a
 *     header, so there is no preflight to force.
 *   - **Content type** (not for an upgrade — it has no body): anything but
 *     `application/json` is refused, 415. A browser must ask first (a
 *     preflight, which this host never approves) before it sends that type
 *     across origins, so requiring it makes a forged request one the browser
 *     refuses to send. It is the same property a required custom header buys
 *     (RFC 10017 §6.1.3.3.2), without breaking every JSON client that already
 *     sends the header and no other.
 *
 * `checkSessionId()` is the fourth bound, and it is not about browsers: a
 * session id is caller data that rides every stored row, log line and trace
 * span of a conversation, so a door refuses one over
 * {@link MAX_SESSION_ID_LENGTH} or carrying a control character.
 *
 * Where it runs: `httpHost` calls `check()` on every request to its request
 * door and on every conversation upgrade, and `checkSessionId()` on the id each
 * dialect reads. An application's OWN routes beside the door (a sign-in route
 * on `onUnhandled`, say) are the application's, and arrive untouched — so this
 * is exported for them to call, and the rule keeps one spelling.
 *
 * Pure: no socket, no clock, no I/O. The design note is
 * `docs/design/2026-09-door-hardening.md`.
 */

import {
  HostNotAllowedError,
  InvalidSessionIdError,
  OriginNotAllowedError,
  UnsupportedMediaTypeError,
  type OriginRefusalRule,
} from './errors.js';

/**
 * The longest session id any door carries, in UTF-16 code units — JavaScript's
 * own `string.length`.
 *
 * 400 is the width the reference SQL session store gives its `session_id`
 * column (`NVARCHAR(400)`, which counts the same units), so no id this door
 * admits is one a store refuses AFTER the model was paid for. The id formats in
 * use fit with room to spare — a UUID is 36 — and there is deliberately no
 * knob: a correlation handle wider than this is not one anybody needs.
 */
export const MAX_SESSION_ID_LENGTH = 400;

/**
 * The cross-site rules a host enforces at its doors. Every field is optional,
 * and the defaults are the safe ones — see each field for what it costs.
 */
export interface CrossSiteOptions {
  /**
   * The page origins allowed to drive this door from a browser —
   * `['https://app.corp.example']`: scheme, host and port, nothing after.
   *
   * **Unset (the default):** a browser request is served only from a page on
   * this door's own name — its Origin must match the request's `Host`, or an
   * `X-Forwarded-Host` a proxy added. That is every app served from the same
   * host as its door, unchanged; an app on ANOTHER origin must be listed.
   *
   * **Know what the default does not do:** it does not stop DNS rebinding.
   * There, the attacker's page and the request's Host both carry the
   * attacker's name, so they match. {@link CrossSiteOptions.allowedHosts} is
   * the defence for that.
   *
   * A listed origin may be on another SITE by design, so a request from one
   * passes even when the browser marks it `Sec-Fetch-Site: cross-site`. Any
   * other request marked that way is refused — the catch for a proxy that
   * strips `Origin`. A reverse proxy must forward `Origin` and `Sec-Fetch-*`
   * unchanged.
   *
   * `'any'` turns both browser checks off — for a door no browser page can
   * reach with a user's ambient authority. `'null'` and `'*'` are refused at
   * construction: the first is every sandboxed frame on every site, the second
   * would read as a pattern it is not.
   */
  readonly allowedOrigins?: readonly string[] | 'any';
  /**
   * The names this door answers for — `['neo.corp.example']`. A request whose
   * `Host` names anything else is refused with 421, which is what stops DNS
   * rebinding. Matched case-insensitively; an entry without a port matches any
   * port, an entry with one matches only it; IPv6 in brackets (`'[::1]'`).
   *
   * **Unset on a LOOPBACK bind** (`127.0.0.1`, `::1`, `localhost` — a host
   * binding its own socket there): `localhost`, `127.0.0.1` and `[::1]`, any
   * port, silently. Such a socket has no other name, so this refuses nobody
   * and closes rebinding on a developer's own machine.
   *
   * **Unset on any other bind:** every Host is served, and the host prints
   * ONE warning at boot naming this option. A deliberate staged default:
   * refusing at boot would stop existing deployments starting.
   *
   * `'any'` serves every Host on purpose and prints nothing — for a door whose
   * port no browser can reach (a platform's front door in front of it). An
   * empty list is refused at construction: it could never serve anything.
   *
   * Health probes are not judged: a load balancer or kubelet sends the
   * target's ADDRESS as Host, and a probe that failed on it would restart a
   * healthy server.
   */
  readonly allowedHosts?: readonly string[] | 'any';
  /**
   * Refuse a request that changes something unless it says
   * `content-type: application/json` (415). Default `true`.
   *
   * `false` is the named escape hatch for a NON-BROWSER integration that
   * cannot send the header. It removes the half of the defence that does not
   * depend on Origin — so set it only on a door no browser can reach, and
   * keep `allowedOrigins` and `allowedHosts` doing their part.
   */
  readonly requireJsonContentType?: boolean;
}

/** {@link doorGuard}'s options: the rules, plus who is refusing. */
export interface DoorGuardOptions extends CrossSiteOptions {
  /** Who refuses — every refusal names it, as every host refusal does. */
  readonly name: string;
  /**
   * The address this door's socket is bound to, when the door bound it
   * itself. A loopback address with `allowedHosts` unset makes the loopback
   * names the list (see {@link loopbackAllowedHosts}), and a refusal then
   * says the list was defaulted and how to set one. Absent: nothing is
   * inferred.
   */
  readonly bindHost?: string;
}

/**
 * The parts of a request the guard reads. A `node:http` `IncomingMessage` is
 * one as it stands; so is a plain `{ method, headers }`. Header names are
 * matched case-insensitively.
 */
export interface DoorRequest {
  /** The HTTP method. Absent is judged as a request that changes something. */
  readonly method?: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

/** Why a request may not enter — one of three, each carrying its own `status`. */
export type CrossSiteRefusal =
  | UnsupportedMediaTypeError
  | OriginNotAllowedError
  | HostNotAllowedError;

/** A guard, built once, asked per request. */
export interface DoorGuard {
  /** The refusal this request earns at the door, or `undefined` to let it in. */
  check(request: DoorRequest): CrossSiteRefusal | undefined;
  /**
   * `true` when `allowedHosts` was left unset — the door answers any Host and
   * the host says so once at boot. `false` for a list or for `'any'`.
   */
  readonly allowedHostsUnset: boolean;
  /**
   * `true` when both browser rules are off (`allowedOrigins: 'any'` and
   * `requireJsonContentType: false`) — the host says so once at boot.
   */
  readonly browserRulesOff: boolean;
}

/** Methods that change nothing, and so are not judged — the ruling's GET/HEAD/OPTIONS. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Build a guard. Configuration a door could only ever misread is refused HERE,
 * at construction, by name — never discovered as a mystery 403 in production.
 */
export function doorGuard(options: DoorGuardOptions): DoorGuard {
  const { name } = options;
  const origins = readAllowedOrigins(name, options.allowedOrigins);
  const defaulted =
    options.allowedHosts === undefined ? loopbackAllowedHosts(options.bindHost) : undefined;
  const hosts = readAllowedHosts(name, options.allowedHosts ?? defaulted);
  const hostRule = defaulted === undefined ? 'listed' : 'loopback-default';
  const requireJson = readRequireJson(name, options.requireJsonContentType);

  return {
    allowedHostsUnset: options.allowedHosts === undefined && defaulted === undefined,
    browserRulesOff: origins === 'any' && !requireJson,
    check(request: DoorRequest): CrossSiteRefusal | undefined {
      const { headers } = request;
      if (hosts !== 'any' && !hostAllowed(hosts, headerOf(headers, 'host'))) {
        return new HostNotAllowedError(name, hostRule);
      }
      const method = (request.method ?? '').toUpperCase();
      const carriesBody = !SAFE_METHODS.has(method);
      const upgrade = isWebSocketUpgrade(headers);
      if (!carriesBody && !upgrade) return undefined;
      const browser = browserVerdict(origins, headers, upgrade);
      if (browser !== undefined) return new OriginNotAllowedError(name, browser);
      if (requireJson && carriesBody && !isJson(headerOf(headers, 'content-type'))) {
        return new UnsupportedMediaTypeError(name);
      }
      return undefined;
    },
  };
}

/**
 * What the BROWSER said about where this request came from, judged against the
 * origin rule — or `undefined` when it may pass.
 *
 * Two facts, in order. `Origin` first: present and not allowed is a refusal.
 * Then Fetch metadata, as defence in depth: a request the browser itself
 * marked `Sec-Fetch-Site: cross-site` is refused unless its Origin is one
 * `allowedOrigins` LISTS — which catches the request whose `Origin` a proxy
 * stripped while `Sec-Fetch-Site` rode through. Neither header can be set by a
 * page, and a request carrying neither is not a browser's.
 *
 * One more, for a WebSocket upgrade only: a browser ALWAYS sends `Origin` on a
 * handshake, and with it `Sec-Fetch-Site`, so a handshake carrying
 * `Sec-Fetch-Site` but no `Origin` is a browser's with its Origin stripped —
 * refused whatever the site says, because a handshake has no content type and
 * no preflight to fall back on. `Sec-Fetch-Site` and not any `Sec-Fetch-*`:
 * Node's own `WebSocket` client sends `Sec-Fetch-Mode: websocket` and no
 * Origin, and it is not a browser page.
 */
function browserVerdict(
  rule: OriginRule,
  headers: DoorRequest['headers'],
  upgrade: boolean,
): OriginRefusalRule | undefined {
  if (rule === 'any') return undefined;
  const origin = headerOf(headers, 'origin');
  const listed = rule !== 'same-host';
  if (origin !== undefined) {
    if (!originAllowed(rule, origin, headers)) return listed ? 'listed' : 'same-host';
    // An origin the deployment LISTED may be on another site by design.
    if (listed) return undefined;
  } else if (upgrade && headerOf(headers, 'sec-fetch-site') !== undefined) {
    return 'fetch-metadata';
  }
  const site = headerOf(headers, 'sec-fetch-site');
  return site?.trim().toLowerCase() === 'cross-site' ? 'fetch-metadata' : undefined;
}

/** Visible ASCII, `!` (0x21) to `~` (0x7E) — nothing else, from any field. */
const VISIBLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * The session-id bound — `undefined` for an id a door may carry (or none).
 *
 * A session id is one to {@link MAX_SESSION_ID_LENGTH} characters of VISIBLE
 * ASCII (0x21–0x7E) — the rule MCP gives its own session ids. Why ASCII and
 * not "Unicode minus the dangerous parts":
 *
 *  - **One id, one byte string, from every field.** Node reads a header value
 *    as latin1 and a JSON body as UTF-8, so `café` in `x-session-id` and `café`
 *    in the body were two different stored conversations. With ASCII only,
 *    the two readings cannot differ.
 *  - **Nothing a log, a span or a store can reinterpret.** Controls, line and
 *    paragraph separators (U+2028/9), bidi overrides (U+202E), zero-width
 *    characters and lone surrogates (which any UTF-8 store rewrites to U+FFFD,
 *    merging two ids) are all outside it — no list of exceptions to keep up.
 *  - Every id format in use already fits: UUIDs, platform runtime ids, `conv_…`.
 *
 * The empty string is refused too: every caller that sent `""` shared ONE
 * conversation. The length is judged first, so an over-long id costs one
 * comparison — after a body read that `maxBodyBytes` bounds.
 */
export function checkSessionId(
  sessionId: string | undefined,
  hostName: string,
): InvalidSessionIdError | undefined {
  if (sessionId === undefined) return undefined;
  if (sessionId.length === 0) {
    return new InvalidSessionIdError('empty', hostName, 0, MAX_SESSION_ID_LENGTH);
  }
  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    return new InvalidSessionIdError('too-long', hostName, sessionId.length, MAX_SESSION_ID_LENGTH);
  }
  if (!VISIBLE_ASCII.test(sessionId)) {
    return new InvalidSessionIdError(
      'invalid-character',
      hostName,
      sessionId.length,
      MAX_SESSION_ID_LENGTH,
    );
  }
  return undefined;
}

/**
 * The names a LOOPBACK-bound door answers to when `allowedHosts` was not set —
 * `localhost`, `127.0.0.1`, `[::1]` (and the bound address itself when it is
 * another `127.x`), any port: the socket already fixes the port, so a name is
 * all a rebinding page can vary. `undefined` for any other bind.
 *
 * It closes DNS rebinding on the classic victim, a developer's own machine,
 * and the MCP SDK's `createMcpExpressApp` does the same for a localhost bind.
 * What it refuses that is legitimate, stated rather than discovered:
 *
 *  - **A reverse proxy on the same machine that forwards the PUBLIC name** in
 *    `Host` (nginx `proxy_set_header Host $host`) — the common case, and the
 *    recommended "bind 127.0.0.1 behind nginx" setup. The proxy's requests
 *    arrive on loopback carrying `neo.corp.example`, which the socket cannot
 *    tell from a rebinding page. List that name in `allowedHosts`; the 421
 *    says so, naming this default (`HostNotAllowedError` · `rule`).
 *  - A hosts-file alias for a loopback address — the same fix.
 *
 * Both fail loudly and in the safe direction, and the fix is the option such
 * a deployment should set anyway.
 *
 * @internal — `doorGuard` asks it with the address a door bound
 * (`DoorGuardOptions.bindHost`).
 */
export function loopbackAllowedHosts(bindHost: string | undefined): readonly string[] | undefined {
  if (!isLoopbackBind(bindHost)) return undefined;
  const names = ['localhost', '127.0.0.1', '[::1]'];
  const literal = (bindHost ?? '').trim().toLowerCase();
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(literal) && literal !== '127.0.0.1') {
    names.push(literal);
  }
  return names;
}

/**
 * `localhost`, any `127.x` literal, and `::1` or `::ffff:127.x` in ANY IPv6
 * spelling (bracketed or not, `0:0:0:0:0:0:0:1`, leading zeros) — IPv6 is
 * canonicalised by the WHATWG URL parser before it is compared.
 */
export function isLoopbackBind(bindHost: string | undefined): boolean {
  if (bindHost === undefined) return false;
  const host = bindHost
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (host === 'localhost' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (!host.includes(':')) return false;
  const canonical = parseUrl(`http://[${host}]`)?.hostname;
  // `::ffff:127.x.y.z` canonicalises to `[::ffff:7fxx:xxxx]`.
  return canonical === '[::1]' || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(canonical ?? '');
}

/**
 * The cross-site rules for a door a PLATFORM fronts — the hosted-runtime
 * adapters' defaults, with whatever the deployment set kept as given.
 *
 * Exempt by default, and why, once for every such adapter: the platform's own
 * front door is the only way to the container's port, and the credential it
 * demands is one no web page holds (a signed request, a bearer the caller
 * attaches) — so a forged browser request cannot authenticate and no browser
 * can reach the port to rebind it. The browser rules would protect nothing
 * there, and which headers the platform forwards (its content type, Origin,
 * Host) is not a fact this library has verified; enforcing them could refuse
 * the platform's own forwarding. Any rule the deployment sets is enforced
 * exactly as on every other door. The session-id bound is NOT exempt: it is
 * not about browsers.
 *
 * @internal — the adapters' shared default, not a public setting.
 */
export function platformFrontedDoor(
  options: CrossSiteOptions,
  bindHost: string | undefined,
): CrossSiteOptions {
  // A LOOPBACK bind is by definition not behind the platform's front door — it
  // is a laptop or a self-hosted box, the classic victim — so it keeps every
  // default a plain `httpHost` has (and the loopback names for `allowedHosts`).
  if (isLoopbackBind(bindHost)) {
    return {
      ...(options.allowedOrigins !== undefined && { allowedOrigins: options.allowedOrigins }),
      ...(options.allowedHosts !== undefined && { allowedHosts: options.allowedHosts }),
      ...(options.requireJsonContentType !== undefined && {
        requireJsonContentType: options.requireJsonContentType,
      }),
    };
  }
  return {
    allowedOrigins: options.allowedOrigins ?? 'any',
    allowedHosts: options.allowedHosts ?? 'any',
    requireJsonContentType: options.requireJsonContentType ?? false,
  };
}

const warnedHostNames = new Set<string>();
const warnedRulesOff = new Set<string>();

/**
 * Said once per host name per process, at boot, when a door serves with the
 * browser rules OFF (`allowedOrigins: 'any'` and `requireJsonContentType:
 * false` — the hosted-runtime adapters' default on a non-loopback bind). Those
 * rules are off because a platform's front door is supposed to be the only way
 * in; a self-hoster on `0.0.0.0` needs to hear that it is not.
 *
 * @internal — the words have one owner; `httpHost` decides when.
 */
export function warnBrowserRulesOff(hostName: string): void {
  if (warnedRulesOff.has(hostName)) return;
  warnedRulesOff.add(hostName);
  // eslint-disable-next-line no-console
  console.warn(
    `[hosting] the '${hostName}' host serves with the browser rules OFF (allowedOrigins: ` +
      `'any', requireJsonContentType: false): any web page a user opens can make their ` +
      `browser send it requests. That is right only when the one way to this port is a ` +
      `platform front door that demands its own credential. Anywhere else — a ` +
      `laptop, a self-hosted VM — set allowedOrigins, allowedHosts and ` +
      `requireJsonContentType: true, or bind to 127.0.0.1.`,
  );
}

/**
 * The staged default, said out loud: a host serving with `allowedHosts` unset
 * prints this ONCE per host name per process, at boot. A name is how every
 * refusal identifies a host, so two hosts sharing one are one door to anyone
 * reading the log — and once is what keeps a warning from becoming noise.
 *
 * @internal — the words have one owner; `httpHost` decides when.
 */
export function warnAllowedHostsUnset(hostName: string): void {
  if (warnedHostNames.has(hostName)) return;
  warnedHostNames.add(hostName);
  // eslint-disable-next-line no-console
  console.warn(
    `[hosting] the '${hostName}' host answers a request for ANY Host name, because ` +
      `allowedHosts is not set. A web page on another domain can re-point its own name at ` +
      `this server's address (DNS rebinding) and then read this door's answers as if it were ` +
      `the app itself — the Origin check cannot tell, because the page's Origin and the ` +
      `request's Host both carry the attacker's name. Set allowedHosts: ['<the name people ` +
      `use to reach it>'] to refuse every other name (421), or allowedHosts: 'any' to state ` +
      `that no browser can reach this port. Serving continues: in this release an unset ` +
      `list is a warning, not a refusal, so existing deployments keep starting.`,
  );
}

// ─── Reading configuration (construction time) ──────────────────────

/** `'same-host'` is the unset default; a Set holds serialized origins. */
type OriginRule = 'any' | 'same-host' | ReadonlySet<string>;

function readAllowedOrigins(name: string, value: unknown): OriginRule {
  if (value === undefined) return 'same-host';
  if (value === 'any') return 'any';
  if (!Array.isArray(value)) {
    throw new TypeError(
      `[hosting] ${name}: allowedOrigins must be a list of origins ` +
        `(['https://app.example']) or 'any'; received ${describe(value)}.`,
    );
  }
  const origins = new Set<string>();
  for (const entry of value as readonly unknown[]) origins.add(readOriginEntry(name, entry));
  return origins;
}

function readOriginEntry(name: string, entry: unknown): string {
  const text = typeof entry === 'string' ? entry.trim() : '';
  if (text === '*') {
    throw new TypeError(
      `[hosting] ${name}: allowedOrigins cannot contain '*'. To turn the Origin check off, ` +
        `pass allowedOrigins: 'any' — a word, so nobody reads it as a wildcard pattern.`,
    );
  }
  if (text.toLowerCase() === 'null') {
    throw new TypeError(
      `[hosting] ${name}: allowedOrigins cannot contain 'null'. It is the origin of every ` +
        `sandboxed frame and data: page on every site, so allowing it would allow them all.`,
    );
  }
  const url = parseUrl(text);
  if (url === undefined || url.origin === 'null' || !bareAuthority(url)) {
    throw new TypeError(
      `[hosting] ${name}: allowedOrigins entry ${JSON.stringify(entry)} is not an origin. ` +
        `An origin is scheme://host[:port] with nothing after it — 'https://app.example'.`,
    );
  }
  return url.origin;
}

/** A host entry, normalized: the name, and a port only when one was listed. */
interface HostEntry {
  readonly hostname: string;
  readonly port?: string;
}

function readAllowedHosts(name: string, value: unknown): 'any' | readonly HostEntry[] {
  if (value === undefined || value === 'any') return 'any';
  if (!Array.isArray(value)) {
    throw new TypeError(
      `[hosting] ${name}: allowedHosts must be a list of host names ` +
        `(['app.example']) or 'any'; received ${describe(value)}.`,
    );
  }
  if (value.length === 0) {
    throw new TypeError(
      `[hosting] ${name}: allowedHosts is an empty list, so every request would be refused — ` +
        `nothing could ever be served. List the names this door is reached by, or pass 'any'.`,
    );
  }
  return (value as readonly unknown[]).map((entry) => readHostEntry(name, entry));
}

function readHostEntry(name: string, entry: unknown): HostEntry {
  const parsed = typeof entry === 'string' ? parseAuthority(entry) : undefined;
  if (parsed === undefined) {
    throw new TypeError(
      `[hosting] ${name}: allowedHosts entry ${JSON.stringify(entry)} is not a host name. ` +
        `Expected a name with an optional port — 'app.example', 'app.example:8443', or an ` +
        `IPv6 address in brackets, '[::1]'.`,
    );
  }
  return parsed;
}

function readRequireJson(name: string, value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') {
    throw new TypeError(
      `[hosting] ${name}: requireJsonContentType must be true or false; received ` +
        `${describe(value)}.`,
    );
  }
  return value;
}

// ─── Judging a request (per request) ─────────────────────────────────

function hostAllowed(entries: readonly HostEntry[], host: string | undefined): boolean {
  const seen = host === undefined ? undefined : parseAuthority(host);
  if (seen === undefined) return false;
  return entries.some(
    (entry) =>
      entry.hostname === seen.hostname && (entry.port === undefined || entry.port === seen.port),
  );
}

function originAllowed(
  rule: 'same-host' | ReadonlySet<string>,
  origin: string,
  headers: DoorRequest['headers'],
): boolean {
  const url = parseUrl(origin.trim());
  if (url === undefined || url.origin === 'null') return false;
  if (rule !== 'same-host') return rule.has(url.origin);
  // The page's own name, as the browser addressed the door: the Host header,
  // or what a proxy in front recorded before rewriting it. A cross-site page
  // cannot set X-Forwarded-Host without a preflight this host never approves.
  //
  // A Host with no port is read under the scheme the client actually used
  // when a proxy said so (`X-Forwarded-Proto`), and under the Origin's scheme
  // otherwise — so `http://name` (port 80) and `https://name` (port 443) are
  // two origins, as they are to a browser.
  const own = authorityKey(url);
  const scheme = forwardedProto(headers) ?? url.protocol;
  const candidates = [
    headerOf(headers, 'host'),
    ...(headerOf(headers, 'x-forwarded-host')?.split(',') ?? []),
  ];
  return candidates.some((candidate) => {
    const parsed = candidate === undefined ? undefined : parseUrl(`${scheme}//${candidate.trim()}`);
    return parsed !== undefined && bareAuthority(parsed) && authorityKey(parsed) === own;
  });
}

/** The first `X-Forwarded-Proto` entry, when it is `http` or `https`. */
function forwardedProto(headers: DoorRequest['headers']): string | undefined {
  const first = headerOf(headers, 'x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return first === 'http' || first === 'https' ? `${first}:` : undefined;
}

/** The media type's essence is exactly `application/json` — never a `+json` cousin. */
function isJson(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const essence = contentType.split(';', 1)[0] ?? '';
  return essence.trim().toLowerCase() === 'application/json';
}

function isWebSocketUpgrade(headers: DoorRequest['headers']): boolean {
  const upgrade = headerOf(headers, 'upgrade');
  if (upgrade === undefined) return false;
  return upgrade
    .toLowerCase()
    .split(',')
    .some((token) => token.trim() === 'websocket');
}

// ─── Small parsers ───────────────────────────────────────────────────

/** One header's value, case-insensitively; repeated values joined as node joins them. */
function headerOf(headers: DoorRequest['headers'], name: string): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) return joined(direct);
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && value !== undefined) return joined(value);
  }
  return undefined;
}

function joined(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join(', ');
}

function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

/** A URL that is nothing but scheme and authority — no credentials, path, query or fragment. */
function bareAuthority(url: URL): boolean {
  return (
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}

/** A `host[:port]` value as a {@link HostEntry}, or `undefined` when it is anything more. */
function parseAuthority(value: string): HostEntry | undefined {
  const url = parseUrl(`http://${value.trim()}`);
  if (url === undefined || !bareAuthority(url) || url.hostname === '') return undefined;
  const hostname = withoutTrailingDot(url.hostname);
  return url.port === '' ? { hostname } : { hostname, port: url.port };
}

/** Host and EFFECTIVE port as one comparable string — a default port spelled out. */
function authorityKey(url: URL): string {
  const hostname = withoutTrailingDot(url.hostname);
  const port = url.port !== '' ? url.port : DEFAULT_PORT[url.protocol] ?? '';
  return `${hostname}:${port}`;
}

const DEFAULT_PORT: Readonly<Record<string, string>> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
};

function withoutTrailingDot(hostname: string): string {
  return hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
}

function describe(value: unknown): string {
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  return Array.isArray(value) ? 'an array' : typeof value;
}
