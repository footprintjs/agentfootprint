[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / renderStatusLine

# Function: renderStatusLine()

> **renderStatusLine**(`state`, `ctx`, `templates?`): `string` \| `null`

Defined in: [src/recorders/observability/status/statusTemplates.ts:209](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/observability/status/statusTemplates.ts#L209)

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

[`StatusState`](/agentfootprint/api/generated/interfaces/StatusState.md) \| `null`

### ctx

[`StatusContext`](/agentfootprint/api/generated/interfaces/StatusContext.md)

### templates?

[`StatusTemplates`](/agentfootprint/api/generated/type-aliases/StatusTemplates.md) = `defaultStatusTemplates`

## Returns

`string` \| `null`
