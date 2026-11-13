---
type: changed
---
**Reads both execution tree forms: footprintjs 13's list of stages and the older linked tree.** footprintjs 13 serves `getSnapshot().executionTree` (and a subflow's tree) as a list of stages in the order they ran, with a fork's children as `branches`; footprintjs 12 and older, and every run saved by them, serve one linked tree (`next` / `children`). Context bisection, the context ledger, the trace tool pack, stored-cause projection and `milestoneStops` now read either form through one reader, with the same results. `milestoneStops`' `executionTree` parameter takes either form, and the `foottrace` dependency moves to `^1.15.0`, the first release whose readers take both.
