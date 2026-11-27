---
title: canReadCodeFiles
---

# Function: canReadCodeFiles()

> **canReadCodeFiles**(`session`): `session is CodeSession & Required<Pick<CodeSession, "readFile">>`

Defined in: [src/provider-contract/types/code.ts:273](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L273)

Can this session read files back out? Read the member, never the adapter's name.

## Parameters

### session

[`CodeSession`](/docs/api/interfaces/CodeSession)

## Returns

`session is CodeSession & Required<Pick<CodeSession, "readFile">>`
