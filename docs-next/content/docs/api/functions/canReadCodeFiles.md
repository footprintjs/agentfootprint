---
title: canReadCodeFiles
---

# Function: canReadCodeFiles()

> **canReadCodeFiles**(`session`): `session is CodeSession & Required<Pick<CodeSession, "readFile">>`

Defined in: [src/provider-contract/types.ts:1271](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1271)

Can this session read files back out? Read the member, never the adapter's name.

## Parameters

### session

[`CodeSession`](/docs/api/interfaces/CodeSession)

## Returns

`session is CodeSession & Required<Pick<CodeSession, "readFile">>`
