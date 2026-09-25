# Door hardening: cross-site requests, DNS rebinding, and the session-id bound

**Status:** built, unreleased (`## [Unreleased]` in the CHANGELOG), 2026-09-25.
**Code:** `src/hosting/doorGuard.ts` (the rules, one owner) · `httpHost.ts`
(both doors ask it) · `webSocketConversation.ts` · `conversationDoor` (the handshake)
· `ingressRecord.ts` · `recordHostRefusal` · `types.ts` · `AgentHost.onRefusal`
· `src/lib/mcp/mcpServe.ts` · `connectHttp`.
**Tests:** `test/hosting/door-guard.test.ts` and
`test/lib/mcp/mcpServe-door-guard.test.ts`, over real sockets.
**Sources:** the security review of the identity-strategies design (findings
B-1, C-2, C-5), the OTel privacy review (the session id in every span), and the
owner's rulings. The primary sources quoted below were read for this note:
RFC 10017, the WHATWG Fetch standard, RFC 9110, and the MCP transport
specification (2025-06-18).

## The threat

The deployment that matters is a door with no verifier behind a company VPN.
There, being able to reach the port is the only authority. The default bind is
`0.0.0.0`, and requests with no session share one fallback agent
(`standingAgent`). Every person inside the VPN runs a browser, and any web page
they open can steer that browser at the door from inside.

Reproduced before the fix, on a real socket (`standingAgent` + `nodeHost`, no
verifier, a mock provider that counts calls):

| Attack | Before | After |
|---|---|---|
| `POST /invoke`, `content-type: text/plain`, JSON body, `Origin: https://evil.example` (what `fetch(url, { mode: 'no-cors', method: 'POST', body })` sends) | 200, **one model call** | 403, zero calls |
| Same body, no `Origin` (a proxy stripped it) | 200 | 415 |
| DNS rebinding: `Host` and `Origin` both `rebind.evil.example` | 200 (the page reads the answer) | 421 with `allowedHosts` or on a loopback bind; still 200 on a non-loopback bind without it (see the Host section) |
| WebSocket handshake, `Origin: https://evil.example` | `101 Switching Protocols` | 403 before the 101 |
| A 1,000,000-character `sessionId` in the body | 200, and the id rides every span | 400 (413 on `nodeHost`, whose body cap is now 1 MiB) |
| Rebinding `tools/call` against a `127.0.0.1`-bound `mcpServe`, no options (devil, round 1) | tool ran, result read | 421, tool never runs |

1. **Blind CSRF.** `httpHost` · `readJson` parsed any body as JSON and ignored
   `content-type`. A page can send `text/plain`, a form encoding, or no content
   type across origins without a preflight. It cannot read the reply, and it
   does not need to: the turn runs, spends the budget, calls the tools, and
   stores a conversation.
2. **DNS rebinding.** Nothing checked `Host`. A page on an attacker's domain
   re-points its own name at the door's address. The browser then treats the
   page as same-origin with the door, and it can read every answer.
3. **Cross-site WebSocket.** The same-origin policy does not cover a WebSocket,
   and nothing checked the handshake's `Origin`.
4. **Unbounded session id.** A caller with no credentials could send a
   megabytes-long session id. It became a store key and rode every exported
   span of the turn.

## The rulings, as built

Every rule runs in every identity mode, including a door with no verifier. Door
hardening is orthogonal to identity.

### 1. A request that changes something must say it is JSON: 415

Every method except GET, HEAD and OPTIONS must carry `content-type` whose
essence is exactly `application/json` (parameters such as `charset` are fine).
Anything else, including no content type at all, is refused with
`UnsupportedMediaTypeError` (415) before the body is read.

**Equivalence with the RFC's custom header (owner ruling 1).** RFC 10017 (BCP
212, *OAuth 2.0 for Browser-Based Applications*) §6.1.3.3 says: "The BFF MUST
implement a proper CSRF defense." Its CORS subsection, §6.1.3.3.2, is where the
custom header lives, and it does not mention content type: "the BFF SHOULD
require that the browser-based application includes a custom request header.
Cross-origin requests with a custom request header always require a preflight,
which makes CORS an effective CSRF defense. When this mechanism is used, the BFF
MUST ensure that every incoming request carries this static header."

The Fetch standard's rule for a CORS-safelisted request header treats
`content-type` as safelisted only when its value parses and its essence is
`application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`.
`application/json` is not safelisted, so a cross-origin request carrying it
requires the same preflight the RFC's custom header forces. This host never
approves a preflight (it answers no `OPTIONS`), so the browser never sends the
request. Requiring the JSON content type is therefore an accepted equivalent,
and no second mandatory header is added. A second header would break every JSON
client that works today (`curl` with the header, servers, SDKs) and buy nothing.

The review cited §6.1.3.3 for "require content-type: application/json". The RFC
does not say that; the custom-header SHOULD is in §6.1.3.3.2.

**The bodiless POST.** §6.1.3.3.2 names the gap directly: "if the resource
server is an API that exposes an endpoint to a bodiless POST request, there will
be no preflight request and no CSRF defense." A `Blob` body with an empty type
sends no `content-type` at all. So a POST with no content type is refused too,
body or not.

**`application/json` exactly, never a `+json` type.** Fetch §3.3.7 (*CORS
protocol exceptions*) lets pages send some non-safelisted types across origins
without a preflight: `application/csp-report`,
`application/expect-ct-report+json`, `application/xss-auditor-report`,
`application/ocsp-request`. Accepting `+json` would admit one of them.

**No parser gap.** The door's essence is the text before the first `;`, trimmed
and lower-cased. That is the same prefix the Fetch MIME parser reads, so a value
the browser would send without a preflight never reads as `application/json`
here. Fetch's own warning case (two `Content-Type` headers combined into
`application/json, text/plain`) fails the browser's parse, so the browser
preflights it, and the door refuses it anyway. A property test checks 5,000
generated values against a transcription of the Fetch rule.

**The refused body.** It is judged on the headers alone and never parsed. Two
connection facts decide whether the caller actually READS the refusal (review
K3/K4):

- *A client still uploading.* Closing a socket with unread bytes in it makes
  the kernel send RST, which a client mid-upload reports as `ECONNRESET`,
  losing the 415. So an invited body announced at most 1 MiB (or chunked) is
  read and thrown away first, up to 1 MiB or 2 s, and the answer goes out after
  (`httpHost` · `drainThenAnswer`). A body announced larger is answered at
  once; a client still sending may see the reset, which is the bound, stated.
  A test uploads exactly 1 MiB as fast as the socket takes it, three times, and
  reads the 415 each time; with the drain removed it saw `ECONNRESET`/`EPIPE`.
- *`Expect: 100-continue`* (curl uses it above 1 MB). By default Node answers
  `100 Continue` before any listener runs, inviting the body it is about to
  refuse. On a socket the host owns, a `checkContinue` listener judges the
  headers first: a refused request gets the 415 and no 100; any other gets its
  100 and the ordinary route. A caller-owned `server` keeps its own
  `checkContinue`, so there Node still says 100 first.

**Escape hatch:** `requireJsonContentType: false`, named, for a non-browser
integration that cannot send the header. It removes the only rule that does not
depend on `Origin`, so it belongs on a door no browser can reach.

### 2. A browser Origin must be allowed: 403

Browsers always send `Origin` on a request whose method is not GET or HEAD, and
on every WebSocket handshake. The Fetch algorithm *append a request `Origin`
header* appends it unconditionally for `websocket` mode, and for any other
non-GET/HEAD request (as `null` under a `no-referrer` policy). So:

- **`Origin` present and not allowed:** refused with `OriginNotAllowedError`
  (403). `null` is always refused. Any sandboxed frame or `data:` page can
  produce it, and the attacker chooses the referrer policy. Listing `'null'` is
  refused at construction.
- **`Origin` absent:** the caller is not a browser (a script, a server, `curl`).
  It is not judged, and every non-browser client keeps working.

**Allowed, when `allowedOrigins` is unset:** the page must be on the door's own
name. The Origin's host and EFFECTIVE port (a default port spelled out) must
equal the request's `Host`, or an entry of `X-Forwarded-Host`. Trusting
`X-Forwarded-Host` here is safe. A cross-site page cannot set it without a
preflight, and a WebSocket handshake cannot set any header, so the only party
that can add it is a proxy.

**How the scheme enters.** The ruling says "scheme+host". This host speaks plain
HTTP, often behind a TLS terminator, so the scheme the browser used is not a
fact the socket has. A `Host` value carries it only through its port. So a
`Host` without a port is read under `X-Forwarded-Proto` when a proxy sends one,
and under the Origin's own scheme otherwise. Behind a TLS proxy that sends the
header (the field app's nginx does), `Origin: http://name` (port 80) and
`https://name` (port 443) are two origins, as they are to a browser. Without the
header, the two default ports cannot be told apart, and a page on port 80 of the
door's own name passes. The residual needs a network attacker on the door's own
name, a POST still needs a preflight, and browsers with schemeful Fetch metadata
mark it cross-site, so only an older browser's WebSocket remains (review S2).

The header is trusted as the proxy sends it, so a WRONG one fails closed. An
outer TLS load balancer in front of an inner nginx whose `$scheme` is `http`
sends `X-Forwarded-Proto: http` for an `https://` page, and every legitimate
browser POST and handshake gets 403. The fix is on the proxy: forward the outer
proto (`proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto` on the
inner hop), or list the page's origin in `allowedOrigins`. Separately, and
older than this packet: nginx's `$host` drops a non-default port, so a door
reached as `https://neo:8443` behind `Host $host` sees `neo` and refuses the
page's `neo:8443` Origin. Forward `$http_host`, which keeps the port.

**What the default does NOT do: stop DNS rebinding.** Under rebinding the page's
Origin is `http://rebind.evil.example` and the request's Host is
`rebind.evil.example`. They match, and the request passes. The app's own doors
used exactly this Origin-equals-Host check (review finding A), and it was never
a rebinding defence. A test pins this: on a non-loopback bind without
`allowedHosts`, the rebinding request is served.

**Allowed, with `allowedOrigins: [...]`:** exactly the listed origins. Each
entry is parsed and must be scheme, host and optional port, with nothing after
it. `'*'` is refused (use `'any'`, a word nobody reads as a pattern). An
explicit list does refuse a rebinding page on the doors' own requests: its
Origin is the attacker's name, which is not listed, and a same-origin POST or
handshake always carries an Origin (`null` at worst, which is refused).
`allowedHosts` is still the direct defence, because it also covers the GET
routes an application serves beside the door.
**`'any'`:** both browser checks are off, for a door no browser page can reach
with a user's ambient authority.

### 3. Fetch metadata, as defence in depth: 403 (owner ruling 2)

A request that changes something, or a WebSocket handshake, marked
`Sec-Fetch-Site: cross-site` is refused unless its Origin is one
`allowedOrigins` lists. This catches the request whose `Origin` a proxy
stripped while the browser's Fetch metadata rode through. No page can set
either header. The refusal says it (`OriginNotAllowedError`, `rule:
'fetch-metadata'`) and tells the operator that a reverse proxy must forward
`Origin` and `Sec-Fetch-*` unchanged.

Only `cross-site` refuses. `same-site` is a cross-origin request inside the
same site, and the Origin check covers it. Under the unset default there is no
list, so any request marked cross-site is refused. A page on the door's own
name is `same-origin`, so this refuses nothing legitimate.

**For a WebSocket handshake, rules 2 and 3 are the whole defence.** The browser
WebSocket API cannot set a custom header or a content type, so there is no
preflight to force. The conversation door judges the handshake before the 101
(review C-2). A browser sends `Origin` AND `Sec-Fetch-Site` on every handshake,
so a handshake carrying `Sec-Fetch-Site` but no `Origin` is a browser's with its
Origin stripped, and is refused whatever the site value (round-1 fix). The rule
keys on `Sec-Fetch-Site`, not on any `Sec-Fetch-*`: Node's own `WebSocket`
client (undici) sends `Sec-Fetch-Mode: websocket` with no `Origin`, verified by
probe, and a test keeps it opening.

### 4. Host must be a configured name: 421

With `allowedHosts: ['neo.corp.example']`, a request whose `Host` names anything
else is refused with `HostNotAllowedError`. This is the rebinding defence.

**The loopback default (round-1 BLOCKING fix).** A host that binds its own
socket to a loopback address (`127.x`, `::1`, `localhost`) with `allowedHosts`
unset answers `localhost`, `127.0.0.1` and `[::1]` (and the bound `127.x` if it
is another one), any port, silently (`doorGuard.ts` · `loopbackAllowedHosts`).
It closes rebinding on the classic victim, a developer's own machine, but it
does refuse legitimate traffic in one common case (round-2 correction). A
reverse proxy on the same machine that forwards the PUBLIC name in `Host`
(nginx `proxy_set_header Host $host`) delivers `neo.corp.example` on loopback,
and the socket cannot tell that from a rebinding page. That is exactly the field
app's recommended `BE_SERVER_HOST=127.0.0.1` behind nginx setup. A hosts-file
alias is the other case. Both fail loudly (421) and in the safe direction, and
the fix is the option such a deployment should set anyway: list the public
name(s) the proxy forwards in `allowedHosts`. So the refusal says it: when the
list was defaulted, the 421 names the loopback default and the proxy fix
(`HostNotAllowedError` · `rule: 'loopback-default'`); an operator's own list
keeps the plain sentence. The default is decided in one place,
`doorGuard` given `bindHost`, which is how the refusal knows. Why the default: the devil's run showed a `127.0.0.1`-bound
`mcpServe` serving a rebinding `tools/call` whose result the page read. The MCP
SDK's own `createMcpExpressApp` does the same for a localhost bind. The same
default applies to `httpHost`/`nodeHost` and to `mcpServe`. A caller-owned
`server`'s address is the caller's and is not guessed.
`Host` is a forbidden request-header name in Fetch, so the browser always sets
it to the name the page used, which under rebinding is the attacker's.

- **Why 421, not 403.** RFC 9110 §15.5.20: an origin server "sends 421 to reject
  a target URI that does not match an origin for which the server has been
  configured". That is exactly this refusal. 403 would say the resource exists
  and is forbidden to this caller. 421 says this server is not that name.
- **`Host` only, never `X-Forwarded-Host`.** After rebinding, the attacker's
  page is same-origin and may set any non-forbidden header, including
  `X-Forwarded-Host: neo.corp.example`. Some proxies append to that header
  rather than replace it.
- **Matching:** case-insensitive, one trailing dot ignored. An entry without a
  port matches any port, and an entry with one matches only that port. IPv6
  goes in brackets. An empty list is refused at construction, because nothing
  could ever be served.
- **On every method**, once set. Health probes are not judged: `httpHost` never
  asks the guard about its GET health path or its HEAD probe, because load
  balancers and kubelets send the target's address as `Host`, and a probe that
  failed on it would restart a healthy server.
- **Unset on a non-loopback bind (the staged default):** every Host is served,
  and the host prints one warning at boot, once per host name per process. The warning names the risk
  (rebinding reads answers, and the Origin check cannot tell) and the option.
  This release does not refuse at boot, so existing deployments keep starting;
  the CHANGELOG says so. **`'any'`:** serve every Host on purpose, no warning.
- **No canonical-host redirect (owner ruling 3).** The library never redirects
  a short name to a canonical one. A deployment lists every name it answers to;
  redirecting belongs to the proxy or the app.

### 5. The session-id bound: 400

A session id must be 1 to `MAX_SESSION_ID_LENGTH` (400) characters of visible
ASCII (0x21–0x7E). Anything else is refused with `InvalidSessionIdError` at
both doors:

- **Request door:** in `httpHost` · `dispatchOne`, after the dialect's
  `readRequest`. It covers every place any dialect reads an id (body field,
  header, cookie) and the id a `session-transcript` / `session-pending` op names
  inside itself. It runs once there, so no dialect can forget it, and before
  anything is framed.
- **Conversation door:** in `conversationDoor` · `handleUpgrade`, after
  `readConversation` (header, cookie, query), before the 101.

**Why 400.** It is the width the reference SQL session store gives `session_id`
(`NVARCHAR(400)`, the same UTF-16 units). The field app's store enforces that
width, and before this change the refusal came at persist time, after the model
was paid. No id the door admits is one a shipped store refuses later. Every id
format in use fits: a UUID is 36, and AgentCore's `runtimeSessionId` needs at
least 33. There is no knob. A wider id is not a legitimate correlation handle,
and the constant is exported so a client can check it before sending.

**Why visible ASCII (round-1 choice), not "Unicode minus a blocklist".** The
devil found five classes the first rule (C0/C1/DEL) let through: U+2028/U+2029
(log forging in JSON-lines and JS viewers), bidi controls such as U+202E
(display spoofing), zero-width characters (two ids that look identical), lone
surrogates (any UTF-8 store rewrites them to U+FFFD, merging two ids), and the
empty string. A regex for those
(`/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|\p{Cs}/u`) would close them. The owner asked for
one choice about header encoding, though: Node reads a header value as latin1
and a JSON body as UTF-8, so `café` in `x-session-id` and `café` in the body
are two stored conversations. Two ways out: normalise, or define the id as
ASCII. ASCII is chosen:

- It makes one id one byte string from every field: a header, a cookie, a
  query, a body. Normalising would mean re-decoding latin1 headers as UTF-8,
  which silently changes ids that arrived as genuine latin1.
- It closes every class above and any future one without a list to maintain.
- It is the rule MCP gives its own `Mcp-Session-Id` ("MUST only contain visible
  ASCII characters (ranging from 0x21 to 0x7E)").
- Every id format in use fits: UUIDs, platform runtime ids, `conv_…`. The cost
  is stated in the change notes: an id with a space or a non-ASCII letter,
  accepted before, is now refused, so a conversation STORED under such an id
  can no longer be reached through the door.

**Migration for those stored conversations.** A session id is caller data, so
the client that minted it re-mints: a new visible-ASCII id starts a new
conversation. To keep the history, copy the stored conversation before or after
upgrading, outside the door: `hydrate(oldId)` from the store and `persist` it
under an ASCII id (a UUID, or `encodeURIComponent(oldId)`, which is visible
ASCII and reversible), then have the client switch to the new id. The session
port has no single-row delete, so the old row leaves with the store's own
retention sweep (`forgetOlderThan`) or its own tooling. Stores key on the exact
string, so nothing finds the old row by the new name on its own. Ids minted by
`browserSessionId()` or `crypto.randomUUID()` are ASCII already and need
nothing.

No store assumed a charset (memory and SQLite store the string, Firestore
hashes it, the AgentCore file store escapes it); the reason is the sinks, where
the id is printed in logs, spans and the ingress record. The empty string is
refused because every caller that sent `""` shared one conversation in `open`
mode (the WebSocket dialect already dropped it).

**The body read before the bound.** The session check runs after the body is
read and parsed. `nodeHost` now defaults `maxBodyBytes` to 1 MiB
(`DEFAULT_NODE_MAX_BODY_BYTES`, the hosted adapters' own number), so no id is
ever judged after an unbounded read. `httpHost` keeps no default, by its
existing law: a number there would be inherited by every adapter, and the field
app's own `httpHost` should set one.

The refusal states the length and the rule. It never contains the id.

### 6. The ingress record

A host refusal happens before any handler runs, so the composer's funnel
(`standingAgent` · `handler` → `beginIngress`) never sees it. The new optional
port member `AgentHost.onRefusal(listener) → Unsubscribe` carries it. Every
`httpHost` implements it. `standingAgent` subscribes when `onIngressDecision`
is set, before `serve`, and unsubscribes on close. The zero-delta path stays
zero.

`recordHostRefusal` files the row. It holds classes only: `door`, `outcome`,
`errorCode`, `errorName`, `bearerPresent`. It never holds a header, a message,
or the session id.

- `IngressDoor` gains `'request'` (the host refused before the composer read
  the body, so which of turn, session-op or artifact it wanted is not recorded)
  and `'conversation'` (a handshake refused on the same host).
- `IngressOutcome` gains `'cross-site-refused'` for the 415, 403 and 421
  refusals. The session-id refusal is `'refused'` with `ERR_INVALID_SESSION_ID`.
- Both unions grew, so an exhaustive `switch` over either stops compiling. The
  CHANGELOG says so.
- Malformed bodies (unparseable JSON, over `maxBodyBytes`, an unknown `op`)
  stay outside the record, as before. They are broken requests, not decisions
  about a caller.

## Where the rule holds

| Door | Browser rules (1–4) | Session bound (5) | Why |
|---|---|---|---|
| `httpHost` request door (`POST` on `invokePath`) | on | on | the door this packet exists for |
| `httpHost` conversation door (upgrade on `conversationPath`) | Host, Origin, Fetch metadata (no body, so no content type) | on | review C-2 |
| `nodeHost` (both doors) | on | on | it is `httpHost` |
| `httpHost` with any custom wire (`a2aWire`, `responsesWire`, yours) | on | on | the guard sits under the wire |
| GET health path, HEAD probe | exempt | n/a | probes send the target address as Host and change nothing |
| `onUnhandled` routes, routes on a caller-owned `server` | the application's | the application's | they arrive exactly as they came off the wire (that option's law). `doorGuard` is exported so they keep the same rule. |
| `agentCoreRuntimeHost`, `agentCoreA2AHost`, `foundryResponsesHost` | **off unless set, on a non-loopback bind** (one boot line says so); a loopback bind keeps every default | on | see below |
| `mcpServe` HTTP transport (outside `src/hosting`) | all of them, the loopback default included | n/a (stateless, no session id) | see below |

**The exemption, argued.** A hosted-runtime adapter serves a port that only the
platform's front door can reach, and that door demands a credential no web page
holds: a signed request, or a bearer the caller attaches. A forged browser
request cannot authenticate, and no browser can reach the port to rebind it, so
the browser rules protect nothing there. Which headers the platform forwards
(content type, `Origin`, `Host`) is not verified. The AgentCore adapter's own
docs record that the browser `/ws` path is unverified end to end, and the
runtime passes the payload through as the caller wrote it. A default Origin
rule could refuse the documented browser WebSocket flow, and a content-type
rule could refuse an invoker that picked another type. So these adapters
default to `allowedOrigins: 'any'`, `allowedHosts: 'any'` and
`requireJsonContentType: false` (`platformFrontedDoor`). Setting any of the
three enforces it exactly as on every other door.

That argument holds only where the platform fronts the port. The devil ran the
original attacks against these adapters self-hosted on `127.0.0.1` and every one
ran the handler, the `null` origin included. So, since round 1, the exemption
applies only on a NON-loopback bind (a platform container binds `0.0.0.0`). A
loopback bind is by definition not behind the platform's front door, so it gets
every plain-host default, the loopback `allowedHosts` included. And a door that
serves with both browser rules off prints one line at boot
(`warnBrowserRulesOff`), so a self-hoster on `0.0.0.0` is told the rules are off
and why.

**`mcpServe` over HTTP is a door too, and it was open.** It runs tools for
whoever reaches its port. The MCP transport specification (2025-06-18,
Streamable HTTP, *Security Warning*) says: "Servers MUST validate the `Origin`
header on all incoming connections to prevent DNS rebinding attacks". Nothing
did: the MCP SDK's `enableDnsRebindingProtection` defaults to off, so a
rebinding page could list and call tools and read the results. Its listener
(`mcpServe.ts` · `connectHttp`) now asks the same `doorGuard` before a server or
transport exists for the request. The options are `allowedOrigins` and
`allowedHosts` on the HTTP transport, with the same defaults (the loopback one
included), the same boot warning and the same refusal classes, answered in the
SDK's JSON-RPC error shape. The content-type rule is the library's too (round
1): the SDK is a peer at range `*`, and an older one matched `application/json`
as a substring, which accepts `text/plain; a=application/json`, a
CORS-safelisted type. The library's rule is equal to or stricter than every SDK
version's, so the SDK's own 415 is simply unreachable rather than a second
owner. Native MCP clients send no `Origin` and are unaffected. A cross-origin browser client
could not reach this endpoint before either: it answers no CORS preflight.
Pinned by `test/lib/mcp/mcpServe-door-guard.test.ts` against the real SDK
client.

## What the field app must set

The field app (`be-server`) builds its own `httpHost` in `beHost`. **Its real
deployment is not the nginx one.** `deploy/seo-be-server.service` runs it as a
systemd unit with `BE_SERVER_HOST=0.0.0.0` "because the team reaches this from
their own machines", and `DEPLOYMENT.md` says the BE brain "is reached over
plain http by design". So the live door is the backend port itself, over plain
HTTP, by hostname or LAN IP. There is no TLS in front of it, so there is no
certificate name check to defeat rebinding either. The nginx config in
`deploy/nginx` (`proxy_set_header Host $host`, `X-Forwarded-Host $host`,
`X-Forwarded-Proto $scheme`, HSTS) is the optional TLS front, and the steps
below hold for both shapes.

1. **Its browser client needs no change.** Every `/invoke` call
   (`be-server/web/src/wire.ts` · `headers`) sends `content-type:
   application/json`, `x-session-id`, and a bearer when signed in, through a
   same-origin relative `fetch`. So its `Origin` is the page's own and matches
   `Host`. Test: *"JSON + x-session-id + its own Origin is served"*.
2. **Set `allowedHosts`** on `beHost`'s `httpHost`, listing every name the team
   uses for DIRECT plain-HTTP access: the short hostname (reached through the
   DNS search suffix), the FQDN, and the machine's IP. If nginx is in front,
   add the name it serves; it preserves `Host`. For example, read a
   comma-separated environment variable and pass the list. A name left out gets
   421. Until the list is set, the boot warning says so and rebinding remains
   open, because the unit binds `0.0.0.0`, not loopback.
   Also set `maxBodyBytes` on that `httpHost` (for example 1 MiB): `httpHost`
   has no default, so the session bound otherwise runs after an unbounded read.
3. **Keep nginx forwarding `Origin` and `Sec-Fetch-*`.** nginx passes client
   headers through by default. Do not add `proxy_set_header Origin ""`.
4. **`/auth/login` (`serveAuth`) is app code the library never sees.** It
   arrives on `onUnhandled` and reads the body with a content-type-blind reader
   (`readSmallJson`). Call `doorGuard({ name: 'be-server auth', allowedHosts
   }).check(req)` before reading it, and answer the refusal. That closes login
   forgery (review C-1): a text/plain form can no longer sign a victim in as the
   attacker. It also closes rebinding on the auth routes.
5. **The evidence and metrics doors** keep their own Origin-equals-Host check
   (review A), which rebinding defeats. Replace it with the same `check(req)`,
   so one rule has one spelling (review H).
6. **Once everyone goes through nginx, bind the backend to `127.0.0.1`**
   (`BE_SERVER_HOST=127.0.0.1`). Rebinding through nginx then also needs a valid
   certificate for the attacker's name, a second fence, and the loopback bind
   gets the loopback `allowedHosts` default for free. The scheme check in rule 2
   only becomes meaningful there too; on direct plain HTTP there is one scheme.
7. The app's own `validId` in the evidence and metrics doors allows 512
   characters and refuses C0 only. Align it with `checkSessionId`.

## Behaviour that changes for existing deployments

- A POST without `content-type: application/json` gets 415. That includes
  `curl -d '{...}'` without `-H` (curl sends a form encoding) and a Node `fetch`
  with a string body and no headers (it sends `text/plain;charset=UTF-8`).
  One test in the suite pinned the old law ("an empty body is an empty input").
  It now sends the header, and pins that the untyped bodiless POST is refused.
- A browser page on another origin gets 403 until it is listed in
  `allowedOrigins`. So does a proxy that rewrites `Host` and adds no
  `X-Forwarded-Host`: nginx's own default `proxy_set_header Host $proxy_host`,
  and a Vite or webpack dev proxy with `changeOrigin: true`.
- A loopback-bound host answers the loopback names only. A hosts-file alias
  must be listed.
- A session id that is empty, over 400 characters, or not visible ASCII gets
  400.
- `nodeHost` refuses a body over 1 MiB (413) unless `maxBodyBytes` says
  otherwise.
- New boot `console.warn` lines: a non-loopback host with `allowedHosts` unset,
  and a door serving with both browser rules off. A test suite that fails on an
  unexpected `console.warn` sees them.

## Considered and not done

- **A second mandatory custom header:** see ruling 1.
- **Judging the health probe:** it would restart healthy servers behind
  address-probing balancers.
- **Trusting `X-Forwarded-Host` for `allowedHosts`:** a rebinding page can set
  it.
- **Refusing `Sec-Fetch-Site: same-site`:** the Origin check already covers
  cross-origin same-site requests, and the ruling names only `cross-site`.
- **Accepting `+json` types:** Fetch §3.3.7.
- **A knob for the session-id ceiling:** no legitimate id needs more, and every
  reference store fits it.
- **Refusing a handshake on any `Sec-Fetch-*` without `Origin`:** it would
  refuse Node's own `WebSocket` client, which sends `Sec-Fetch-Mode` alone.
- **Defaulting `mcpServe`'s bind to `127.0.0.1`:** the spec's SHOULD, and the
  SDK's default. It changes where an existing server listens, so it is left for
  a release that can say so; the loopback `allowedHosts` default already covers
  a server that binds loopback.
- **Draining a refused body of any size:** unbounded work for a caller the door
  has already refused. The drain stops at 1 MiB or 2 s.
- **Refusing at boot when `allowedHosts` is unset:** staged. This release warns.
- **Redirecting to a canonical host:** owner ruling 3.
