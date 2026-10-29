---
title: CodeCommandResult
---

# Interface: CodeCommandResult

Defined in: [src/provider-contract/types.ts:1343](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1343)

What one shell command produced — only what the backend reported.

## Properties

### checkpointSeen?

> `readonly` `optional` **checkpointSeen?**: `boolean`

Defined in: [src/provider-contract/types.ts:1361](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1361)

Present IFF a `checkpoint` was asked for: whether stdout held that line.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/provider-contract/types.ts:1351](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1351)

The exit status the backend reported. ABSENT when it reported none: the
outcome is unknown. Never inferred from [CodeCommandResult.isError](/docs/api/interfaces/CodeCommandResult#iserror),
never defaulted, never derived from the output.

***

### isError?

> `readonly` `optional` **isError?**: `boolean`

Defined in: [src/provider-contract/types.ts:1357](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1357)

The backend's own error flag, as it reported it (AgentCore's `isError`);
absent when it reported none. It is NOT an exit status — a command can
fail without it, and it can be set with no exit status at all.

***

### stderr

> `readonly` **stderr**: `string`

Defined in: [src/provider-contract/types.ts:1345](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1345)

***

### stdout

> `readonly` **stdout**: `string`

Defined in: [src/provider-contract/types.ts:1344](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1344)

***

### truncated?

> `readonly` `optional` **truncated?**: [`CodeTruncation`](/docs/api/interfaces/CodeTruncation)

Defined in: [src/provider-contract/types.ts:1359](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1359)

Present IFF output was cut — see [CodeTruncation](/docs/api/interfaces/CodeTruncation).
