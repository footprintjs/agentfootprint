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

## Files
- `mcpClient.ts`, `mockMcpClient.ts` — inbound.
- `mcpServe.ts` — outbound.
- `gatewayTransport.ts`, `transportUrl.ts`, `throttleRetry.ts` — transport.
- `toolExtras.ts` — our own declarations, carried over MCP.
- `connectionRefusals.ts`, `sdkLoadFailure.ts` — the two refusals, authored once.
- `types.ts`, `index.ts`.
