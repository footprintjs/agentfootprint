---
type: breaking
bump: major
---
**Snapshots and saved recordings include recorded value types and array lengths by default.** Read a path at a replay commit with `contextShapeAt` from `agentfootprint/observe`. Redacted values withhold their type and length. Recursive discovery is opt-in.

Migration: If you store, hash or compare the JSON from `getSnapshot()`, `getLastSnapshot()` or `recordRun(agent)`, eligible snapshots now contain a `contextShapes` field and their bytes change. Pass `{ contextShapes: false }` to the snapshot getter or as the second argument to `recordRun` to keep the previous bytes.
