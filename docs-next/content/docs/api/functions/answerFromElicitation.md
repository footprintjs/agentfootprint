---
title: answerFromElicitation
---

# Function: answerFromElicitation()

> **answerFromElicitation**(`awaiting`, `content`): [`InputResponse`](/docs/api/interfaces/InputResponse)

Defined in: src/lib/mcp/elicitation.ts:182

The `InputResponse` an accepted elicitation's `content` names — each open
field's value, a time range's two properties joined as `from/to`. Throws
`InputRequestError` on a property the elicitation did not ask, on a choice
AND a free entry for one field, and on half a range. The values are judged
by `agent.resume`, as any answer is.

## Parameters

### awaiting

[`AwaitingInput`](/docs/api/interfaces/AwaitingInput)

### content

`unknown`

## Returns

[`InputResponse`](/docs/api/interfaces/InputResponse)
