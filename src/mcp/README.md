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
- `requestLedger.ts`, `seriesEvidence.ts`, `callLifetime.ts` — which dispatched
  call a request belongs to, that request's series written down for the call's
  run, and the call's own lifetime: what cancels it, what its settling stops,
  and the "may have run" failure.
- `replay.ts` — who may send a tool call again (the app's declaration, one
  permission rule) and what is known of a series' effect.
- `backoff.ts` — `exponentialBackoff` and `statedWaitFirst`, stand-ins for
  footprintjs's own helpers (same names and laws) until a release ships them.
- `toolExtras.ts` — our own declarations, carried over MCP.
- `toolResult.ts` — text and explicitly opted-in structured result decoding.
- `elicitation.ts` — a typed ask (`AwaitingInput`) as an MCP elicitation and the
  client's content back as an `InputResponse` (`elicitationOf`,
  `answerFromElicitation`); a time range travels as two `date-time` properties.
- `connectionRefusals.ts`, `sdkLoadFailure.ts` — the two refusals, authored once.
- `types.ts`, `index.ts`.

## A retried call is in the run that made it

The retry series is the one retry owner, and it runs inside the transport's
`fetch` — built before any run, handed only a serialized body. A call the agent
dispatched still gets its request's attempts in its own run: the dispatcher puts
an internal port on the call's context (`tools/requestEvidence.ts`), the MCP tool
keys a ticket by the request's params OBJECT, the watched transport binds it to
the JSON-RPC id the SDK assigned, and the series claims it from its own body.
Identity at every hop, never content: two calls with the same arguments, or two
runs on one client, cannot claim each other's request, and nothing is added to
the wire. The series files ONE `agentfootprint.tools.request_attempts` when the
request ends — and, for a cancellation, the moment it lands. Every request the
series sent is a row, or counted in `omitted`. One cut in flight is a `cut` row,
`remote: 'unknown'`: it was sent, and the server may have run it — a cut is never
recorded as not run. A request never sent has no row.

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
from the record and a documented service guarantee. Each attempt records three
facts apart, none read from another: its `failure` (footprintjs's category), its
`effect` (`none` | `unknown` | `applied`, footprintjs's effect law), and — when
another attempt followed — the `permission` that allowed it.

**Why.** A generic 429 does not prove non-execution: RFC 6585 §4 defines it as
rate limiting, and `Retry-After` says when to ask again, not that asking is safe.
A vendor's SDK may retry its own 429s because the vendor documents its own
service; a generic MCP client cannot assume that of an arbitrary server. So:

| Situation | Sent again automatically? | Recorded |
|---|---|---|
| A documented pre-execution refusal from the adapter you chose (AgentCore's session-busy) | Yes, within the budget | `effect: 'none'`, `guarantee: 'agentcore-session-busy'`, `permission: { by: 'adapter' }` |
| Any other server, and your declaration names `throttle` for the tool | Yes | `effect: 'unknown'`, `permission: { by: 'declaration', on: 'throttle' }` |
| Any other server, no declaration, `policy: 'app-authorized'` | No — the refusal is returned | `reason: 'not-permitted'` |
| Any other server, no declaration, `policy: 'compatibility'` (the 11.x default) | Yes — today's behaviour | `effect: 'unknown'`, `permission: { by: 'compatibility', assumes: 'refused-before-execution' }` |

A request that failed in transport without an answer (footprintjs's `network`: a
lost connection, a timeout below the series) is sent again only when the entry
names `network`. A 5xx is an answer and never is. **The side-effect guard** holds
under every policy: a tool declared `changes: true` is never sent again unless the
server is declared to deduplicate (`deduplicates`) and the call carries the key —
and a key protects only when the server uses it. A repeat re-sends the SAME
request: the same body, server and session, as the same identity (a credential is
vended afresh for each attempt, for that identity). The protocol's own requests
(`initialize`, `tools/list`, notifications) run no tool and keep the 429 retry.

**Uncertainty survives** (`SeriesKnowledge`). The `end` says how many requests
were sent (`attempts`) and what is known of the whole series: once any attempt is
`unknown`, so is the series — a later proven refusal does not resolve it, and a
later success does not prove the operation happened once. `applied` means the
call completed (the server answered, not with an error), never that anything was
written; an answered attempt's effect comes from the call's verdict, so a ticketed
request files when its call settles (or at once, when cancelled). After a repeat
that followed an attempt of unknown effect, on a declaration's or an adapter's
permission, a call that does not complete fails as "may have run" — footprintjs's
`UnknownEffectError`, its own error as the `cause` (`callLifetime.ts`), and the
`end` says `mayHaveRun: true`. The compatibility policy's assumed 429s do not
raise it: that policy keeps today's behaviour, and its record names the assumption.

```ts
const orders = await mcpClient({
  name: 'orders',
  transport: { transport: 'http', url },
  replay: {
    policy: 'app-authorized', // opt-in in 11.x; the default from the next major
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

**Moving to the next major.** `'app-authorized'` becomes the default. To keep
today's behaviour, write `replay: { policy: 'compatibility' }` — its records keep
naming the assumption. To move now, list each tool you want sent again on a 429
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
