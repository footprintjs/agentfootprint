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

## Files
- `mcpClient.ts`, `mockMcpClient.ts` — inbound.
- `mcpServe.ts` — outbound.
- `gatewayTransport.ts`, `transportUrl.ts`, `throttleRetry.ts` — transport.
- `toolExtras.ts` — our own declarations, carried over MCP.
- `toolResult.ts` — text and explicitly opted-in structured result decoding.
- `connectionRefusals.ts`, `sdkLoadFailure.ts` — the two refusals, authored once.
- `types.ts`, `index.ts`.

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

`test/lib/mcp/mcpStructuredResult.test.ts` checks the old default, both explicit
modes, malformed/error refusals and a native Agent execution wrapper that stores
the exact rows in the authenticated invocation scope without sending them in the
next model request.
