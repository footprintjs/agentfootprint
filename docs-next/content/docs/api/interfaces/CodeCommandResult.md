---
title: CodeCommandResult
---

# Interface: CodeCommandResult

Defined in: [src/provider-contract/types.ts:1350](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1350)

What one shell command produced — only what the backend reported.

## Properties

### checkpointSeen?

> `readonly` `optional` **checkpointSeen?**: `boolean`

Defined in: [src/provider-contract/types.ts:1371](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1371)

Present IFF a `checkpoint` was asked for: whether stdout held that line.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/provider-contract/types.ts:1358](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1358)

The exit status the backend reported. ABSENT when it reported none: the
outcome is unknown. Never inferred from [CodeCommandResult.isError](/docs/api/interfaces/CodeCommandResult#iserror),
never defaulted, never derived from the output.

***

### isError?

> `readonly` `optional` **isError?**: `boolean`

Defined in: [src/provider-contract/types.ts:1364](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1364)

The backend's own error flag, as it reported it (AgentCore's `isError`);
absent when it reported none. It is NOT an exit status — a command can
fail without it, and it can be set with no exit status at all.

***

### stderr

> `readonly` **stderr**: `string`

Defined in: [src/provider-contract/types.ts:1352](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1352)

***

### stdout

> `readonly` **stdout**: `string`

Defined in: [src/provider-contract/types.ts:1351](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1351)

***

### terminatedBy?

> `readonly` `optional` **terminatedBy?**: `string`

Defined in: [src/provider-contract/types.ts:1367](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1367)

The signal that ended the command before it exited, when the runner knows
 it (`'SIGKILL'`). There is no `exitCode` then, and none is made up.

***

### truncated?

> `readonly` `optional` **truncated?**: [`CodeTruncation`](/docs/api/interfaces/CodeTruncation)

Defined in: [src/provider-contract/types.ts:1369](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1369)

Present IFF output was cut — see [CodeTruncation](/docs/api/interfaces/CodeTruncation).
