[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / selectCommentaryKey

# Function: selectCommentaryKey()

> **selectCommentaryKey**(`event`): `string` \| `null` \| `undefined`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:159](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/commentary/commentaryTemplates.ts#L159)

Pick the template key for an event. Branches encoded in the key
suffix (no conditional logic in the templates themselves).

  `null`      → explicit skip (baseline injections, low-signal events)
  `undefined` → fall through to caller's default humanizer
  `string`    → render `templates[key]` with `extractCommentaryVars`

## Parameters

### event

[`AgentfootprintEvent`](/agentfootprint/api/generated/type-aliases/AgentfootprintEvent.md)

## Returns

`string` \| `null` \| `undefined`
