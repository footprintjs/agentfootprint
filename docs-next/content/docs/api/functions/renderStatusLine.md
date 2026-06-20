---
title: renderStatusLine
---

# Function: renderStatusLine()

> **renderStatusLine**(`state`, `ctx`, `templates?`): `string` \| `null`

Defined in: [src/recorders/observability/status/statusTemplates.ts:209](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/observability/status/statusTemplates.ts#L209)

Resolve the matched template + substitute vars.

  • `state === null`           → null (chat bubble renders nothing)
  • `state === 'tool'`         → tries `tool.<toolName>` first, then
                                  generic `tool`
  • Other states               → looks up the state's name as the key

Missing template keys return null rather than the empty string —
keeps the contract honest (consumer can detect "no template" and
fall back to its own default).

## Parameters

### state

[`StatusState`](/docs/api/interfaces/StatusState) \| `null`

### ctx

[`StatusContext`](/docs/api/interfaces/StatusContext)

### templates?

[`StatusTemplates`](/docs/api/type-aliases/StatusTemplates) = `defaultStatusTemplates`

## Returns

`string` \| `null`
