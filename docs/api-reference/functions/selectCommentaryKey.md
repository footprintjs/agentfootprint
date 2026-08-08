[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / selectCommentaryKey

# Function: selectCommentaryKey()

> **selectCommentaryKey**(`event`): `string` \| `null` \| `undefined`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:177](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/recorders/observability/commentary/commentaryTemplates.ts#L177)

Pick the template key for an event. Branches encoded in the key
suffix (no conditional logic in the templates themselves).

  `null`      → explicit skip (baseline injections, low-signal events)
  `undefined` → fall through to caller's default humanizer
  `string`    → render `templates[key]` with `extractCommentaryVars`

## Parameters

### event

`AgentfootprintEvent`

## Returns

`string` \| `null` \| `undefined`
