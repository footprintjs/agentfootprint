**Mixed** — one MCP client per authenticated conversation, for one server: who holds which client, what is charged, and what ends when.
Walker: `pool.ts` (the state machine: admission, one open per key, leases, making room, endings), `work.ts` (an operation's charge and the work under it until it settles), `clientSet.ts` (the open and ending sets), `definitions.ts` (lists per client incarnation, the shared entries, invalidation), `boundTool.ts` (the five checks of a bound tool's call), `listTools.ts`, `lease.ts`, `plan.ts`, `identityKey.ts`, `options.ts`, `pooledClient.ts`, `mcpClientPool.ts` (the facade).
Lens: `errors.ts` and `sessionEnded.ts` — the fixed sentences a refused or failed call reaches the model as, registered in `test/modelFacingSurfaces.test.ts`.
Trace: `record.ts` — the facts one use files as `agentfootprint.tools.mcp_client`, and the reports `onEvent` receives outside a run.

The rules and an example are in `src/mcp/README.md` (“A client per conversation”); the
design is `docs/design/2026-10-mcp-client-pool.md`.
