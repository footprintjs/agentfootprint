---
title: CodeCommandResult
---

# Interface: CodeCommandResult

Defined in: [src/provider-contract/types.ts:1379](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1379)

What one shell command produced — only what the backend reported.

## Properties

### checkpointSeen?

> `readonly` `optional` **checkpointSeen?**: `boolean`

Defined in: [src/provider-contract/types.ts:1400](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1400)

Present IFF a `checkpoint` was asked for: whether stdout held that line.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/provider-contract/types.ts:1387](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1387)

The exit status the backend reported. ABSENT when it reported none: the
outcome is unknown. Never inferred from [CodeCommandResult.isError](/docs/api/interfaces/CodeCommandResult#iserror),
never defaulted, never derived from the output.

***

### isError?

> `readonly` `optional` **isError?**: `boolean`

Defined in: [src/provider-contract/types.ts:1393](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1393)

The backend's own error flag, as it reported it (AgentCore's `isError`);
absent when it reported none. It is NOT an exit status — a command can
fail without it, and it can be set with no exit status at all.

***

### stderr

> `readonly` **stderr**: `string`

Defined in: [src/provider-contract/types.ts:1381](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1381)

***

### stdout

> `readonly` **stdout**: `string`

Defined in: [src/provider-contract/types.ts:1380](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1380)

***

### terminatedBy?

> `readonly` `optional` **terminatedBy?**: `string`

Defined in: [src/provider-contract/types.ts:1396](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1396)

The signal that ended the command before it exited, when the runner knows
 it (`'SIGKILL'`). There is no `exitCode` then, and none is made up.

***

### truncated?

> `readonly` `optional` **truncated?**: [`CodeTruncation`](/docs/api/interfaces/CodeTruncation)

Defined in: [src/provider-contract/types.ts:1398](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1398)

Present IFF output was cut — see [CodeTruncation](/docs/api/interfaces/CodeTruncation).
