**Support** — the two-directional transport: `mcpClient` pulls someone else's
tools in, `mcpServe` pushes ours out.

## What it reads / what it writes
- Reads a remote catalog, or serves our own tool declarations.
- Holds no run state and composes no model-facing sentence of its own. What the
  model is OFFERED from an imported catalog is decided later, by the tool list
  (`src/tool-providers/`) and the tools slot.

## The one law here
A tool is two things at once — execution and declaration — and both must survive
the wire (`toolExtras.ts`). A refusal here names WHY, because "install it" is
only one of the reasons a connection fails.

`mcpServe.ts` uses `tools/toolArgsValidation.ts` after the before-tool
middleware chain and before credentials or execution. A rejected call returns
an MCP tool error with the shared correction; after-tool middleware does not
run. This boundary always enforces the validator's supported subset and has
no Agent warn/off dial. Accepted arguments and schema objects retain their
identity; omitted arguments are not converted to an empty object. An open
schema still allows extra fields. Direct `Tool.execute` and the MCP client's
existing argument coercion are not changed by server-side admission.

`mcpServe` over HTTP runs the hosting door guard (`src/hosting/doorGuard.ts`)
before any tool runs. A browser `Origin` it does not allow gets 403. A POST that
does not say `content-type: application/json` gets 415 from this library, not
from whichever SDK version is installed. A `Host` it was not configured for gets
421, which is the DNS-rebinding defence the MCP transport spec requires. On a
loopback `host` with `allowedHosts` unset, only the loopback names are answered.

```ts
await mcpServe(tools, {
  transport: { transport: 'http', port: 8931, allowedHosts: ['tools.corp.example'] },
});
```

A call's own time crosses the same way (the time layer, step T5a): a call handed
`ctx.time` sends it in the `tools/call` request's `_meta.agentfootprint.time`
(`toolExtras.ts` · `callMetaOf`), the mock client hands that `_meta` to a
handler's second argument, and `mcpServe` hands a served tool the context the
client sent (`toolExtras.ts` · `callTimeOf` — read, never repaired; one it cannot
read is not handed on). A tool's `period` forms and facts travel in the listing's
`_meta.agentfootprint.period`, judged like every other field.

```ts
mockMcpClient({ tools: [{ name: 'client_activity', inputSchema, _meta: { agentfootprint: { askOrAssume, period } },
  handler: async (args, request) => query(args, request._meta?.agentfootprint) }] });
```

## Files
- `mcpClient.ts`, `mockMcpClient.ts` — inbound.
- `mcpServe.ts` — outbound.
- `gatewayTransport.ts`, `transportUrl.ts`, `throttleRetry.ts` — transport.
  `throttleRetry.ts` runs each call as ONE footprintjs `attempt()` series; a
  transport fetch that already retries is joined, never wrapped.
- `requestLedger.ts`, `callMarker.ts`, `seriesEvidence.ts`, `callLifetime.ts` —
  which dispatched call a request belongs to (by a private `_meta` marker the
  transport strips), that request's series written down for the call's run, and
  the call's own lifetime: what cancels it, what its settling stops, and the
  "may have run" failure.
- `replay.ts` — who may send a tool call again (the app's declaration, one
  permission rule) and what is known of a series' effect.
- `replayUnavailable.ts` — what `'app-authorized'` needs of a connection, and the
  typed refusal (`McpReplayUnavailableError`) when the connection cannot give it.
- `backoff.ts` — `exponentialBackoff` and `statedWaitFirst`, stand-ins for
  footprintjs's own helpers (same names and laws) until a release ships them.
- `toolExtras.ts` — our own declarations, carried over MCP.
- `toolResult.ts` — text and explicitly opted-in structured result decoding.
- `elicitation.ts` — a typed ask (`AwaitingInput`) as an MCP elicitation and the
  client's content back as an `InputResponse` (`elicitationOf`,
  `answerFromElicitation`); a time range travels as two `date-time` properties.
- `connectionRefusals.ts`, `sdkLoadFailure.ts` — the two refusals, authored once.
- `types.ts`, `index.ts`.

## A cancelled request is never sent for a late credential (`gatewayTransport.ts`)

**The rule.** The gateway's vending fetch (`createVendingFetch`) treats the
credential as a wait like any other, under `lib/abort.ts`. The request's own
signal is resolved the way fetch resolves it: `init.signal` when the init names
one (`null` meaning none), otherwise a `Request` input's own signal. On the MCP
path it carries the transport's signal and, for a dispatched call or under a
deadline, the cancellation the retry series links in. The vending fetch honours
it in three places:

- an aborted request asks no provider;
- the provider is handed the signal (`CredentialRequest.signal`), and the wait
  for the credential is raced against it, so it ends at the abort, with the
  abort;
- the signal is checked again once the credential arrives, before the request
  is handed on.

The guarantee is the gateway's: it stops waiting at the abort and never uses a
late credential. A provider that ignores the signal may still finish its own
work, and its late credential is dropped unused. `withCredentialRetry` checks
the signal immediately before every attempt, the first included, so a cancelled
request never asks its provider again, even after a zero-length wait or an
`onRetry` that cancelled it. With no abort, the provider is asked and the request
is sent exactly as before. A request with no signal asks the provider with no
`signal` key at all.

Only the gateway route passes a signal so far. The agent's own credential
resolution (declare-and-push in `toolCalls`, `toolDispatch`) and `mcpServe`'s
`needs` still call `getCredential` without one.

**Why.** The vend used to be deaf. A stalled provider stayed pending after the
call was cancelled, and a credential that arrived after a timeout still sent the
request, so the server could run a call the caller had given up on.

```ts
// A provider that does its own I/O hands the signal on, and stops with it:
const credentials: CredentialProvider = {
  id: 'vault',
  async getCredential({ service, signal }) {
    const res = await fetch(`${VAULT}/token/${service}`, { signal });
    return { status: 'issued', credential: bearer((await res.json()).token) };
  },
};
// One that ignores it may finish its own work, but the gateway rejects at the
// abort and sends nothing when the credential arrives later.
```

## A retried call is in the run that made it

The retry series is the one retry owner, and it runs inside the transport's
`fetch` — built before any run, handed only a serialized body. A call the agent
dispatched still gets its request's attempts in its own run: the dispatcher puts
an internal port on the call's context (`tools/requestEvidence.ts`), the MCP tool
puts a library-private marker in its request's `_meta` (`callMarker.ts`), the
watched transport takes the marker out again and binds the call to the JSON-RPC
id the SDK assigned, and the series claims it from its own body. The marker, not
the params object, is what ties the request to the call, so an SDK that copies
the params is still matched. Never content: two calls with the same arguments,
or two runs on one client, cannot claim each other's request, and the server
receives the bytes it always did. The series files ONE
`agentfootprint.tools.request_attempts` when the request ends — and, for a
cancellation, the moment it lands. Every request the series sent is a row, or
counted in `omitted`. One cut in flight is a `cut` row, `remote: 'unknown'`: it
was sent, and the server may have run it — a cut is never recorded as not run. A
request never sent has no row.

Cancellation never waits on attribution (`callLifetime.ts`): the call's
`ctx.signal` and the client's reach the SDK request while the call runs, and the
ledger stops any `tools/call` the SDK sends `notifications/cancelled` for. A call
that settles before its series (the SDK's own timeout) cuts the series in a
`finally`, inside the call, so nothing is filed after the run and nothing more is
sent.

```ts
// what a saved run gives back for a call throttled once, then answered
{ toolCallId: 'tc-1', toolName: 'search_tickets', iteration: 1, endpoint: 'tickets-gateway',
  attempts: [
    { attempt: 1, outcome: 'refused', reason: 'retryable', status: 429, kind: 'throttle',
      failure: 'rate-limited', waitMs: 1000, retryAfterMs: 1000 },
    { attempt: 2, outcome: 'answered', reason: 'answered', status: 200 } ],
  omitted: 0,
  end: { outcome: 'answered', reason: 'answered', status: 200 } }
```

A response received is `answered` with its status — a 503 is never success.
`refused` is a response the retry policy recognises as a refusal (a 429, a
session-busy reply), recorded as the server sent it — not proof that nothing
ran. Who may send a call again, and what each attempt is known to have done,
are the next section's.
A row holds numbers and the library's own words; a failure is a fixed sentence
and its category, never the thrown error's text. See `seriesEvidence.ts`.

## Who may send a tool call again (`replay.ts`)

**The rule.** Permission to repeat is the APP's, declared per (server, tool) when
the client is built — never the model's, a tool description's or a server
annotation's (`readOnlyHint`). What is known of an attempt's effect comes only
from the record and an established service guarantee — and no reply is one.
Each attempt records three facts apart, none read from another: its `failure`
(footprintjs's category), its `effect` (`none` | `unknown` | `applied`,
footprintjs's effect law), and — when another attempt followed — the
`permission` that allowed it.

**Why.** A generic 429 does not prove non-execution: RFC 6585 §4 defines it as
rate limiting, and `Retry-After` says when to ask again, not that asking is safe.
A vendor's SDK may retry its own 429s because the vendor documents its own
service; a generic MCP client cannot assume that of an arbitrary server. Nor is
AgentCore's session-busy body proof: AWS documents a retryable conflict while a
session starts or stops, and the body is matched by its code and words, which a
server behind the runtime can send after it ran the call. So every attempt that
was sent and did not complete is `unknown`, and `none` is only a request never
sent:

| Situation | Sent again automatically? | Recorded |
|---|---|---|
| The adapter you chose retries its own refusal (AgentCore's session-busy) | Yes, within the budget — the adapter's policy | `effect: 'unknown'`, `permission: { by: 'adapter', assumes: 'refused-before-execution' }` |
| Any other server, and your declaration names `throttle` for the tool | Yes | `effect: 'unknown'`, `permission: { by: 'declaration', on: 'throttle' }` |
| Any other server, no declaration, `policy: 'app-authorized'` | No — the 429 is returned as the server sent it | `reason: 'not-permitted'`, `effect: 'unknown'` |
| Any other server, no declaration, `policy: 'compatibility'` (the default, kept in 12.0) | Yes — today's behaviour | `effect: 'unknown'`, `permission: { by: 'compatibility', assumes: 'refused-before-execution' }` |

A request that failed in transport without an answer (footprintjs's `network`: a
lost connection, a timeout below the series) is sent again only when the entry
names `network`. A 5xx is an answer and never is. `retryOnThrottle: false` turns
off the 429 rule and nothing else: a declared `network` repeat (and the strict
policy's record) keeps its series, with the default budget. **The side-effect guard** holds
under every policy: a tool declared `changes: true` is never sent again unless the
server is declared to deduplicate (`deduplicates`) and the call carries the key —
and a key protects only when the server uses it. A repeat re-sends the SAME
request: the same body, server and session, as the same identity (a credential is
vended afresh for each attempt, for that identity). The protocol's own requests
(`initialize`, `tools/list`, notifications) run no tool and keep the 429 retry.

**Uncertainty survives** (`SeriesKnowledge`). The `end` says how many requests
were sent (`attempts`) and what is known of the whole series: once any attempt is
`unknown`, so is the series — a later refusal does not resolve it, and a later
success does not prove the operation happened once. `applied` means the call
completed (the server answered, not with an error), never that anything was
written; an answered attempt's effect comes from the call's verdict, so a ticketed
request files when its call settles (or at once, when cancelled).

**What the caller sees under `'app-authorized'`** (footprintjs's law; the record is
the same under both policies). Two layers are kept apart: a row's `outcome:
'answered'` is the HTTP observation — a response arrived — and not the MCP call's
answer, which the ledger watches for by JSON-RPC id (a 202, or a stream, can be
accepted and never carry it). Then:

- a received refusal or error — a 429, a 503, a JSON-RPC or tool error, or a chain
  in which every attempt received one — keeps the server's error as it came; its
  effect stays `unknown`, and the record says why it was not sent again;
- a call that genuinely lacked an answer somewhere — an attempt with no response at
  all, or a request accepted over HTTP whose JSON-RPC answer never came — and then
  fails, fails as "may have run": `UnknownEffectError`, its final error (a later
  refusal's, or the timeout) as the `cause` (`callLifetime.ts`), and the `end` says
  `mayHaveRun: true`;
- a call that completes returns normally, and the series' effect stays `unknown`
  after an earlier unknown attempt;
- a cancellation keeps the caller's reason; once a request was sent, the record
  says its effect is `unknown`.

Under `'compatibility'` the caller sees the error it always did; the record still
says the effect is unknown and names the policy's assumption.

**What `'app-authorized'` needs of a connection** (`replayUnavailable.ts`). The
rule above rests on two things the library must establish for every call, never
assume: its request is matched to the call, and its answer is seen. When either is
missing, the tool call is refused BEFORE its request is sent, with
`McpReplayUnavailableError` (`sent: false`) and a typed `reason`. Only tool
invocations (`tools/call`) are refused. Connecting (`initialize`) and listing
tools run first and may already have reached the server (on `stdio`, the server
process has started), so `sent: false` speaks of that tool request alone.

| `reason` | What is missing | When |
|---|---|---|
| `'answers-unobserved'` | The `initialize` answer never passed the library's observer | An MCP SDK whose `connect` replaces the transport's `onmessage` handler instead of keeping it (SDK 1.10 does when run; reading the source finds the same through 1.13) |
| `'request-unmatched'` | The request reached the transport without its call's marker | An SDK that rebuilds the params and drops `_meta` — on any call, including after the connection initialized |
| `'requests-unwatched'` | The library cannot watch the transport's requests at all | `stdio`, or a transport whose `send` cannot be wrapped |

The rule tests what the connection does, never an SDK version number or a
transport's name.

**Why.** Without them, a request the server accepted and never answered would
reach the caller as a plain timeout: the strict contract, silently weakened. A
refusal says so instead, and the tool request never reaches the server. An
explicit `'app-authorized'` never falls back to `'compatibility'`: not when a
connection cannot give these facts, not when a request loses its match after the
connection initialized, and a refused request is never sent again to recover the
match. `'compatibility'` asks none of this and behaves as before: it never treats
an unwatched response as unanswered.

An answer's watch ends, by its request id, when the answer arrives, when the SDK
cancels the request, when the call settles (found by its marker) or when the client
closes. It never ends when only the HTTP send finished: a 202 or a stream can still
carry the answer later.

```ts
try {
  await tool.execute(args, ctx);
} catch (error) {
  if (error instanceof McpReplayUnavailableError) {
    // This tool request was not sent; connecting and listing tools may have
    // been. error.reason names what this connection cannot give. Choose
    // policy: 'compatibility' for this server (its stated assumption, not the
    // strict guarantees), or a connection that gives both facts.
  }
}
```

```ts
const orders = await mcpClient({
  name: 'orders',
  transport: { transport: 'http', url },
  replay: {
    policy: 'app-authorized', // opt-in; 'compatibility' stays the default in 12.0
    tools: {
      search_orders: { on: ['throttle', 'network'] },
      create_order: { on: ['throttle'], changes: true },
    },
    deduplicates: { argument: 'idempotency_key' }, // set by your code, never the model
  },
});
// a search throttled once, then answered — what the saved run's row says:
// { attempt: 1, outcome: 'refused', reason: 'retryable', status: 429, kind: 'throttle',
//   failure: 'rate-limited', waitMs: 200, effect: 'unknown',
//   permission: { by: 'declaration', on: 'throttle' }, durationMs: 41 }
```

**The default stays `'compatibility'` in 12.0.** 11.5.0 said `'app-authorized'`
would become the default in the next major. That is superseded: 12.0.0 keeps
`'compatibility'` as the default, as an interim policy rather than a permanent
one. Strict refuses a tool call it cannot observe and correlate, so as a default
it would refuse every tool invocation over `stdio`, and every one through an MCP
SDK that replaces the transport's handler. `'compatibility'` keeps its stated
retry assumption, and its records keep naming it; it does not gain the strict
policy's observation or correlation guarantees. A strict default may come in a
later major, after the supported transport and SDK combinations are measured,
with migration notes; none is scheduled. A `policy` you write is the one used: a
default never replaces it, and nothing picks it from the transport. To choose
`'app-authorized'` now, list each tool you want sent again on a 429
(`on: ['throttle']`), mark the tools that make changes (`changes: true`), and
declare `deduplicates` only for a server that honours the key.

## Structured results for execution adapters

`mcpClient({ resultMode: 'structured', ... })` returns a successful tool's
`structuredContent` as a JSON object, so an execution wrapper can store declared
datasets through its bound `ctx.artifacts` before model projection. This option
works with both library-built transports and caller-owned `connection` objects.
It changes result decoding only: tool source, input schema, declarations and
permission checks keep their existing owners. It does not validate a producer's
claims, infer tables or create artifact references by itself.

For a producer that explicitly returns JSON in text, use
`resultMode: 'structured-or-json'`. When `structuredContent` is absent, this
accepts exactly one text block containing a JSON **object**. Prose, Markdown
fences, scalar/array roots, multiple blocks and legacy `toolResult` are refused.
Present but malformed structured content never falls back to text. `isError`
still refuses the call even if a structured object is present. The failure keeps
tool-authored text diagnostics (for example, `HTTP 422: node must be complete`)
when all content blocks are text, up to 32 blocks and 8,192 UTF-16 characters
including newline separators. Only own data properties are read; getters,
`toJSON` and structured error payloads are never invoked or inspected. Missing,
malformed or over-limit diagnostics use a generic error without partial advice.
Decoding errors, separately, name the contract without including payload values.

Plain objects and arrays are recognised by structure, not by identity with this
realm's `Object.prototype`, so data built in another realm (jest's environment,
`node:vm`) is accepted. What the tool returns is a **copy** made of this realm's
objects, built from property descriptors read once each — so nothing the source
does after the check (a Proxy trap, a replaced method on a foreign prototype)
reaches your code. A null prototype stays null and an own `__proto__` key stays
a key; a sub-object the source shared is copied (and counted) on each path.
Class instances, accessors anywhere on the value or its inherited path, and
forged or `__proto__`-swapped prototypes are refused. Proxies are refused before
any trap runs wherever the runtime can name one (Node); elsewhere only what
their traps answered is copied. See `plainData.ts`.

Both opt-in modes preserve nested zero, false and null, and reject non-JSON
values rather than coercing them. Validation visits at most 1,000,000 values and
64 nested containers; the JSON-text fallback also accepts at most 16,000,000
UTF-16 characters. These limits apply after the transport has received the
response; this is not streaming ingestion or a download-size limit.

Omit `resultMode` (or use `'text'`) for the unchanged text/legacy behavior.
`mockMcpClient` accepts the same option: existing string handlers represent one
text block; a handler can instead return an `McpCallToolResult` envelope to test
structured content and errors through the shared decoder. Example:

```ts
const client = mockMcpClient({
  resultMode: 'structured',
  tools: [{
    name: 'inventory', inputSchema: { type: 'object' },
    handler: async () => ({
      content: [], structuredContent: { rows: [{ latency: 0, missing: null }] },
    }),
  }],
});
```

`test/mcp/mcpStructuredResult.test.ts` checks the old default, both explicit
modes, malformed/error refusals and a native Agent execution wrapper that stores
the exact rows in the authenticated invocation scope without sending them in the
next model request.
