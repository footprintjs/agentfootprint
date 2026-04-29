[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MEMORY\_TIMING

# Variable: MEMORY\_TIMING

> `const` **MEMORY\_TIMING**: `object`

Defined in: [agentfootprint/src/memory/define.types.ts:89](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L89)

When the memory's READ subflow runs.

Default `TURN_START` reads memory once per `agent.run()`. Use
`EVERY_ITERATION` only when the strategy is sensitive to in-loop tool
results — every-iteration multiplies store-latency by iteration-count.

## Type Declaration

### EVERY\_ITERATION

> `readonly` **EVERY\_ITERATION**: `"every-iteration"` = `'every-iteration'`

### TURN\_START

> `readonly` **TURN\_START**: `"turn-start"` = `'turn-start'`
