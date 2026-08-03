[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / selectCommentaryKey

# Function: selectCommentaryKey()

> **selectCommentaryKey**(`event`): `string` \| `null` \| `undefined`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:168](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/recorders/observability/commentary/commentaryTemplates.ts#L168)

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
