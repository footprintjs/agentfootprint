---
title: canRunCodeCommands
---

# Function: canRunCodeCommands()

> **canRunCodeCommands**(`session`): `session is CodeSession & Required<Pick<CodeSession, "runCommand">>`

Defined in: [src/provider-contract/types/code.ts:281](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L281)

Can this session run shell commands? Absent unless the runner was built
 with `commands: true`. Read the member, never the adapter's name.

## Parameters

### session

[`CodeSession`](/docs/api/interfaces/CodeSession)

## Returns

`session is CodeSession & Required<Pick<CodeSession, "runCommand">>`
