**Mixed** — standalone units used by the MCP pool state machine.
Walker: `endings.ts` adapts half-open and local-close effects. Fold: `requests.ts` and `responses.ts` classify protocol evidence. Lens: `refusals.ts` owns fixed timeout/close errors; `contracts.ts` holds internal shapes.

This folder is sealed behind [`../pool.ts`](../pool.ts). Only that facade and files inside this folder import these modules. Callers keep their existing facade type imports. No helper owns pool state, client indexes, charges, leases or waiter collections.

| Owner          | Boundary                                                                         | Adjacent proof                                   |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `requests.ts`  | Existing notification/answer classification and tool-call detection              | `requests.test.ts`                               |
| `responses.ts` | Inspect a cloned response; original body stays available                         | `responses.test.ts`                              |
| `endings.ts`   | End-only port; immediate unresolved outcome versus actual local-close settlement | `endings.test.ts`                                |
| `refusals.ts`  | Exact timeout/abort errors and canonical context-moved classification            | `refusals.test.ts`                               |
| `contracts.ts` | Held lease, served list and request-evidence types                               | Existing facade consumers and hosted type checks |

These are whole-unit Stage A moves. The lifecycle class stays in `../pool.ts`; the public `McpPoolStats` declaration and canonical error/work classes keep their owners. Integrated reservation, capacity, cancellation, expiry and send-gate tests remain in `test/mcp/pool/`. This is navigation of existing behavior, not a new chart execution.
