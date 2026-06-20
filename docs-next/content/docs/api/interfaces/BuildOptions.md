---
title: BuildOptions
---

# Interface: BuildOptions

Defined in: [src/lib/injection-engine/skillGraph.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L45)

Options for `.build()`.

## Properties

### check?

> `readonly` `optional` **check?**: [`GraphCheckMode`](/docs/api/type-aliases/GraphCheckMode)

Defined in: [src/lib/injection-engine/skillGraph.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L53)

Run the build-time check-up (see `graph.checkup()`):
  • `'throw'` — throw if any ERROR-level problem (unknown-skill / no-entry);
  • `'warn'`  — console.warn every problem in dev mode (`enableDevMode()`), silent otherwise;
  • `'off'`   — skip it entirely.
Default `'warn'`. `graph.checkup()` is always available regardless.
