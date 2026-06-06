[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MEMORY\_TIMING

# Variable: MEMORY\_TIMING

> `const` **MEMORY\_TIMING**: `object`

Defined in: [src/memory/define.types.ts:89](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/memory/define.types.ts#L89)

When the memory's READ subflow runs.

Default `TURN_START` reads memory once per `agent.run()`. Use
`EVERY_ITERATION` only when the strategy is sensitive to in-loop tool
results — every-iteration multiplies store-latency by iteration-count.

## Type Declaration

### EVERY\_ITERATION

> `readonly` **EVERY\_ITERATION**: `"every-iteration"` = `'every-iteration'`

### TURN\_START

> `readonly` **TURN\_START**: `"turn-start"` = `'turn-start'`
