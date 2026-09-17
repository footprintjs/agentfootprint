---
title: allow
---

# Function: allow()

## Call Signature

> **allow**(): [`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`never`\>

Defined in: [src/core/agent/middleware/outcomes.ts:22](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L22)

Pass the value through untouched.

### Returns

[`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`never`\>

## Call Signature

> **allow**(`value`, `why`): [`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`never`\>

Defined in: [src/core/agent/middleware/outcomes.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L31)

Pass the value through untouched, and say why you were comfortable.

The row still reads `changed: false` — nothing moved — but it carries the
reason, which is what a rule that remembers an earlier decision needs:
"approved by dana@ops at 14:02" belongs in the record of the call it
silently permitted, not only in the record of the call that asked.

### Parameters

#### value

`undefined`

#### why

`string`

### Returns

[`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`never`\>

## Call Signature

> **allow**\<`T`\>(`value`, `why`): [`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`T`\>

Defined in: [src/core/agent/middleware/outcomes.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L39)

Replace the value and say why.

The `why` is mandatory and lands in the ledger next to the before/after
pair, so a run that was scrubbed can be read back as a run that was
scrubbed rather than as a run whose input was always that way.

### Type Parameters

#### T

`T`

### Parameters

#### value

`T`

#### why

`string`

### Returns

[`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`T`\>
