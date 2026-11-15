**Mixed** — one MCP client per authenticated conversation, for one server: who holds which client, what is charged, and what ends when.
Walker: `pool.ts` owns lifecycle state; Lens: `errors.ts` and `sessionEnded.ts` own fixed served refusals.

Walker: [`mcpClientPool.ts`](mcpClientPool.ts) is the public entry; [`pool.ts`](pool.ts) owns the single state machine. Follow the responsibility below instead of reading every lifecycle at once.

| Question                                                     | Code owner                                                                                                                             | Behavior controls                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is an operation admitted, and when does its charge return?   | `pool.ts` admission → [`work.ts`](work.ts)                                                                                             | [`operations`](../../../test/mcp/pool/operations.test.ts), [`sendGate`](../../../test/mcp/pool/sendGate.test.ts)                                          |
| Which incarnation opens or takes a lease?                    | `pool.ts` opening/leases → [`clientSet.ts`](clientSet.ts), [`pooledClient.ts`](pooledClient.ts), [`plan.ts`](plan.ts)                  | [`open-once`](../../../test/mcp/pool/open-once.test.ts)                                                                                                   |
| Which clients can end or make room?                          | `pool.ts` ending/draining → the same client sets and budget                                                                            | [`capacity`](../../../test/mcp/pool/capacity.test.ts), [`churn`](../../../test/mcp/pool/churn.test.ts), [`expiry`](../../../test/mcp/pool/expiry.test.ts) |
| Is a served tool still bound to its list and identity?       | [`listTools.ts`](listTools.ts), [`boundTool.ts`](boundTool.ts), [`definitions.ts`](definitions.ts), [`identityKey.ts`](identityKey.ts) | [`binding`](../../../test/mcp/pool/binding.test.ts), [`definitions`](../../../test/mcp/pool/definitions.test.ts)                                          |
| Which transport messages pass, and what did an answer prove? | `pool.ts` guarded transport → [`pool/`](pool/README.md) protocol/response helpers                                                      | Adjacent helper tests; integrated `sendGate` and `expiry` controls                                                                                        |
| What does an app-held lease expose?                          | [`lease.ts`](lease.ts) over the pool's held lease                                                                                      | Existing open-once, capacity and expiry controls                                                                                                          |

The sealed [`pool/`](pool/README.md) folder contains standalone helpers and internal contracts. Its plain predicates, response inspection and local-close adapters hold no pool state. Only `pool.ts` and files inside that folder import them. `McpPoolStats` stays declared in `pool.ts`; other callers keep their facade type imports.

Lens: [`errors.ts`](errors.ts) and [`sessionEnded.ts`](sessionEnded.ts) own the fixed sentences a refused or failed call reaches the model as, registered in `test/modelFacingSurfaces.test.ts`.

Trace: [`record.ts`](record.ts) owns the facts one use files as `agentfootprint.tools.mcp_client`, and reports `onEvent` receives outside a run.

Stage A extracts whole helpers and internal contracts only. The stateful `Pool` class remains oversized; it needs a separately reviewed Stage B design for lifecycle delegation. Completion means at most 600 physical lines or an explicit named remainder ruling. This path map describes existing code, not a new implemented flowchart or recorded run.

The rules and an example are in [`src/mcp/README.md`](../README.md) (“A client per conversation”); the historical design and its implementation corrections are in [`docs/design/2026-10-mcp-client-pool.md`](../../../docs/design/2026-10-mcp-client-pool.md).
