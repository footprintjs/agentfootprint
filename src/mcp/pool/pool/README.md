**Mixed** — one pool's lifecycle delegates and standalone units, sealed behind its state-owning facade.
Walker: `opening.ts`, `leases.ts`, `endingLifecycle.ts`, `listing.ts`, `transport.ts` and `drain.ts` coordinate effects through narrow host ports. Fold: `requests.ts` and `responses.ts` classify protocol evidence. Lens: `refusals.ts` owns fixed lifetime errors.

Only [`../pool.ts`](../pool.ts) and files inside this folder import these modules. Callers keep their facade type imports. Each delegate constructor retains only its host port; the facade supplies actual owners, live getters and synchronous cross-owner callbacks. Delegates neither import another delegate nor create another client set, budget, lease collection or waiter list.

| Owner                | One job                                                                   | Behavior proof                                                 |
| -------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `opening.ts`         | One open per key, timeout, failed-open retirement and caller detachment   | Existing `open-once` and `operations` suites                   |
| `leases.ts`          | Reservation-to-lease handoff, release and app-lease revocation            | Existing `open-once`, `capacity` and property controls         |
| `transport.ts`       | Guard every pooled request and classify response evidence                 | Existing `sendGate`, `binding` and `expiry` suites             |
| `listing.ts`         | Serve/invalidate definitions and recheck their context                    | Existing `definitions` and `binding` suites                    |
| `endingLifecycle.ts` | Reserve capacity, defer endings and account for actual settlement         | Existing `capacity`, `churn`, `operations` and `expiry` suites |
| `drain.ts`           | Terminate/close rounds, idle waits and settlement notification            | Existing `churn`, `expiry` and property controls               |
| `requests.ts`        | Existing notification/answer classification and tool-call detection       | Adjacent `requests.test.ts`                                    |
| `responses.ts`       | Inspect a cloned response; original body stays available                  | Adjacent `responses.test.ts`                                   |
| `endings.ts`         | End-only port; immediate unresolved outcome versus local-close settlement | Adjacent `endings.test.ts`                                     |
| `refusals.ts`        | Exact timeout/abort errors and canonical context-moved classification     | Adjacent `refusals.test.ts`                                    |
| `contracts.ts`       | Internal held lease, served list and request-evidence shapes              | Facade consumers and hosted type checks                        |

Integrated behavior controls remain in `test/mcp/pool/`. Preserve their reservation, cancellation, context, guard and settlement cases; a forwarding-call assertion is not a substitute. Canonical `ClientSet`, `PooledClient`, `Work`/`OperationBudget`, definitions and errors stay in their existing owners. The public `McpPoolStats` declaration stays in the facade.

Admission precedes sends; reservation/check/move sections remain synchronous. Abort does not release a charge. A remote outcome can precede local settlement. Shutdown stays mark closed → revoke app leases → abort lifetime. Promise forwarders add no `async`/`await`. This is a code-navigation map, not a newly recorded chart.
