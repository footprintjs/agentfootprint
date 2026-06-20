---
title: renderCommentary
---

# Function: renderCommentary()

> **renderCommentary**(`template`, `vars`): `string`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:422](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/observability/commentary/commentaryTemplates.ts#L422)

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
