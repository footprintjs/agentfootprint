---
title: CodeCommandResult
---

# Interface: CodeCommandResult

Defined in: [src/provider-contract/types.ts:1287](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1287)

What one shell command produced — only what the backend reported.

## Properties

### checkpointSeen?

> `readonly` `optional` **checkpointSeen?**: `boolean`

Defined in: [src/provider-contract/types.ts:1308](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1308)

Present IFF a `checkpoint` was asked for: whether stdout held that line.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/provider-contract/types.ts:1295](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1295)

The exit status the backend reported. ABSENT when it reported none: the
outcome is unknown. Never inferred from [CodeCommandResult.isError](/docs/api/interfaces/CodeCommandResult#iserror),
never defaulted, never derived from the output.

***

### isError?

> `readonly` `optional` **isError?**: `boolean`

Defined in: [src/provider-contract/types.ts:1301](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1301)

The backend's own error flag, as it reported it (AgentCore's `isError`);
absent when it reported none. It is NOT an exit status — a command can
fail without it, and it can be set with no exit status at all.

***

### stderr

> `readonly` **stderr**: `string`

Defined in: [src/provider-contract/types.ts:1289](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1289)

***

### stdout

> `readonly` **stdout**: `string`

Defined in: [src/provider-contract/types.ts:1288](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1288)

***

### terminatedBy?

> `readonly` `optional` **terminatedBy?**: `string`

Defined in: [src/provider-contract/types.ts:1304](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1304)

The signal that ended the command before it exited, when the runner knows
 it (`'SIGKILL'`). There is no `exitCode` then, and none is made up.

***

### truncated?

> `readonly` `optional` **truncated?**: [`CodeTruncation`](/docs/api/interfaces/CodeTruncation)

Defined in: [src/provider-contract/types.ts:1306](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1306)

Present IFF output was cut — see [CodeTruncation](/docs/api/interfaces/CodeTruncation).
