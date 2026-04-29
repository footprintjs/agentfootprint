[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / renderThinkingLine

# Function: renderThinkingLine()

> **renderThinkingLine**(`state`, `ctx`, `templates?`): `string` \| `null`

Defined in: [agentfootprint/src/recorders/observability/thinking/thinkingTemplates.ts:209](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/thinking/thinkingTemplates.ts#L209)

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

[`ThinkingState`](/agentfootprint/api/generated/interfaces/ThinkingState.md) \| `null`

### ctx

[`ThinkingContext`](/agentfootprint/api/generated/interfaces/ThinkingContext.md)

### templates?

[`ThinkingTemplates`](/agentfootprint/api/generated/type-aliases/ThinkingTemplates.md) = `defaultThinkingTemplates`

## Returns

`string` \| `null`
