---
title: allow
---

# Function: allow()

middleware — PUBLIC barrel. The governance chain family.

Two chains, one vocabulary:

  `.toolMiddleware(...)`     wraps every tool dispatch
  `.messageMiddleware(...)`  wraps the message boundary — the input
                             before the model sees it, the output before
                             the caller receives it

Three verbs: `allow`, `deny`, `ask`. There is no fourth, and in
particular there is no way to return a result — see `types.ts`.

A tool link may speak twice: `onToolCall` about the call, `onToolResult`
about the result. The chain is walked forwards for the first and backwards for the
second, so the first-declared link has the first word going in and the last
word coming out.

## Call Signature

> **allow**(): [`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`never`\>

Defined in: [src/core/agent/middleware/outcomes.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L28)

Pass the value through untouched.

### Returns

[`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`never`\>

## Call Signature

> **allow**(`value`, `why`): [`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`never`\>

Defined in: [src/core/agent/middleware/outcomes.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L37)

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

Defined in: [src/core/agent/middleware/outcomes.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L45)

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

## Call Signature

> **allow**\<`T`\>(`value`, `why`, `origin`): [`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`T`\>

Defined in: [src/core/agent/middleware/outcomes.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L59)

Replace the value, say why, and DECLARE where each rewritten argument's
value came from — `'person'` (the person gave it, e.g. from a receipt of
their answer), `'app'` (the app's own fact) or `'default'` (an app default
nobody in the conversation chose). Recorded on the decision row. For an
argument a tool's `askOrAssume` rules, the answer's standing reads a rewrite
with no declared origin — or with `'default'` — as assumed.

### Type Parameters

#### T

`T`

### Parameters

#### value

`T`

#### why

`string`

#### origin

##### from

`ArgumentOrigins`

### Returns

[`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`T`\>

### Example

```ts
allow({ ...call.args, window: receipt.window }, 'window from the collected receipt', {
    from: { window: 'person' },
  });
```
