[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MEMORY\_TIMING

# Variable: MEMORY\_TIMING

> `const` **MEMORY\_TIMING**: `object`

Defined in: [src/memory/define.types.ts:89](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/memory/define.types.ts#L89)

When the memory's READ subflow runs.

Default `TURN_START` reads memory once per `agent.run()`. Use
`EVERY_ITERATION` only when the strategy is sensitive to in-loop tool
results — every-iteration multiplies store-latency by iteration-count.

## Type Declaration

### EVERY\_ITERATION

> `readonly` **EVERY\_ITERATION**: `"every-iteration"` = `'every-iteration'`

### TURN\_START

> `readonly` **TURN\_START**: `"turn-start"` = `'turn-start'`
