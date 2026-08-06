[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / renderCommentary

# Function: renderCommentary()

> **renderCommentary**(`template`, `vars`): `string`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:422](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/recorders/observability/commentary/commentaryTemplates.ts#L422)

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
