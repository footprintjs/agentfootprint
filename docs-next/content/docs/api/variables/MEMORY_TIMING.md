---
title: MEMORY_TIMING
---

# Variable: MEMORY\_TIMING

> `const` **MEMORY\_TIMING**: `object`

Defined in: [src/memory/define.types.ts:90](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L90)

When the memory's READ subflow runs.

Default `TURN_START` reads memory once per `agent.run()`. Use
`EVERY_ITERATION` only when the strategy is sensitive to in-loop tool
results — every-iteration multiplies store-latency by iteration-count.

## Type Declaration

### EVERY\_ITERATION

> `readonly` **EVERY\_ITERATION**: `"every-iteration"` = `'every-iteration'`

### TURN\_START

> `readonly` **TURN\_START**: `"turn-start"` = `'turn-start'`
