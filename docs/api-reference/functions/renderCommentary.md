[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / renderCommentary

# Function: renderCommentary()

> **renderCommentary**(`template`, `vars`): `string`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:458](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/recorders/observability/commentary/commentaryTemplates.ts#L458)

Render a template by substituting `{{name}}` placeholders from the
vars bag. Missing keys render as empty string — keeps prose
forgiving when an optional field isn't present.

Non-recursive: a substituted value is NOT itself processed for
placeholders. Compose sub-templates upstream (see
`extractCommentaryVars`).

## Parameters

### template

`string`

### vars

`Record`\<`string`, `string`\>

## Returns

`string`
