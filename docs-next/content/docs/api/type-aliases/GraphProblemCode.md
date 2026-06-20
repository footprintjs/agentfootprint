---
title: GraphProblemCode
---

# Type Alias: GraphProblemCode

> **GraphProblemCode** = `"unknown-skill"` \| `"no-entry"` \| `"unreachable-skill"` \| `"ambiguous-routes"` \| `"self-loop"` \| `"body-foreign-tool"` \| `"body-unknown-tool"`

Defined in: [src/lib/injection-engine/skillGraphCheckup.ts:17](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraphCheckup.ts#L17)

skillGraph check-up — build-time validation of a declared graph.

Pure + side-effect-free. Catches wiring mistakes at authoring time instead of
mid-run: a skill nobody can reach, an edge to a skill that isn't in the graph,
two un-prioritized edges leaving one skill, a graph with no start, a self-loop.

Surfaced two ways:
  • `graph.checkup()` → `{ ok, problems }` — always available, call it whenever.
  • `.build({ check: 'throw' | 'warn' | 'off' })` — run it at build time.

`unreachable-skill` is a WARNING, not an error: a skill with no incoming edge is
still legitimately reachable by the model via `read_skill`. Only `unknown-skill`
and `no-entry` are true errors.
