# Optional latency measurements and deterministic correctness checks

Build with `npm run build`, then run `node bench/performance/run.mjs`.
The runner prints five latency samples for the guard, the 2,000-result assessment plus JSON serialization,
and parse/account/show over the reduced repository recording. Set
`AF_ANSWER_ACCOUNT_RECORDING` to measure an explicitly provided full recording.
No model or backend is called. Measurements have no pass/fail latency threshold
and run outside coverage. Checked-in JSON receipts identify Node and exact input
and selected direct source bytes; they describe those local runs, not a portable CI speed promise.

Correctness tests count the operation they name: input reads, callback invocations,
regex admissions, formatter constructions, requested waits or delivery order.
These counters do not measure opaque native backtracking, allocations or all work
on derived copies. Each cost claim states its observable and its limits.
The original 500 large-record consistency checks remain in 20 bounded cases,
with 20 reference folds (520 actual folds in that load matrix).

## Scope of the class sweep

The baseline at `33c03321` contained 59 raw elapsed-time or tight-loop sites
across 49 test files. This change replaces their speed ceilings with observable
work, requested waits or barrier ordering. The optional full-recording timing
case moves here; its existing functional recording check remains in the suite.
The hand-written password timing comparison becomes equal KDF/compare call and
cost assertions. That checks equal operations, not constant-time native internals.

| Area | Deterministic observable |
| --- | --- |
| Local commands | Real child entry, logical deadline, owned-group KILL and actual exit |
| Providers and retry | Fetch attempts, requested thinking/backoff delays, cancellation and no reopen |
| Parallel and streaming | A failed/aborted caller settles while admitted sibling work remains held |
| Ask and assessment | Schema/input reads, output validation, 500 large-record byte comparisons |
| Event dispatch | Each matching listener called once, unrelated listeners never called |
| Hosting and sign-in | No body/model work before refusal; exact audit, KDF and lifecycle calls |
| Routing and skill catalogs | Predicate/pair comparisons, real file reads and catalog admissions |
| Memory decay | One batch clock read and two timestamp reads per entry |
| Time parsers | Source fields, native regex/split admissions, formatter cache construction/eviction |
| Strategy delivery/shutdown | Queue-before-delivery order, flush/stop counts and logical deadlines |

The separate F3 follow-up covers the calibrated `test/helpers/perf.ts` harness:
127 cases in 94 files at that baseline. It waits until lane A's AF 14 migration
lands, then removes callers in coordinated PRs and deletes the harness with its
last caller. Calibration and ratios are still wall-clock measurements; they are
not described as deterministic work counts here.

Timestamp/TTL arithmetic, minimum-delay assertions, existing fake-clock contracts
and generous test safety budgets remain. No timing budget or threshold is raised,
no retry is added, and no new skip is introduced. Source hash fields in a result
are selected input identifiers, not proof of the complete compiled dependency graph.
