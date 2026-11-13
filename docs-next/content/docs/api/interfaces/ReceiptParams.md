---
title: ReceiptParams
---

# Interface: ReceiptParams

Defined in: [src/core/agent/receipt/receipt.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L292)

The sampling knobs the call went out with — scalars and short strings, no
bytes, no privacy change.

They decide the answer as surely as the prompt does: the same context at
`temperature: 0` and at `1.2` is a different call, and "why did this turn
ramble?" is unanswerable from a record that kept the prompt and dropped the
dial.

READ OFF THE PREPARED REQUEST — the object the port is handed, after the
cache strategy has had it. This is the one part of a receipt that describes
the post-strategy request rather than the pre-strategy one, and deliberately
so: a strategy holds the whole composed request and can move a dial, and
`params` claims in this very docstring to be what the PORT got.
`time-travel/servedView.ts` · `SERVED_GAPS` says the same from the other side —
`cache-transform` names every field the log rebuilds pre-strategy, and
`params` is not among them.

PORT VALUES ONLY — see [RECEIPT\_BOUNDARY](/docs/api/variables/RECEIPT_BOUNDARY). An unset `maxTokens` may
still become the model's own maximum inside a vendor SDK, and the receipt
records that the library sent nothing, never what the vendor decided.

## Example

**compare the dial two turns went out on**

```ts
import { receiptAt } from 'agentfootprint';

const snapshot = agent.getSnapshot()!;
receiptAt(snapshot, 1)?.params.temperature; // 0.25
receiptAt(snapshot, 2)?.params.temperature; // 0.25 — the dial did not move
receiptAt(snapshot, 1)?.params.stop;        // undefined: none was sent
```

## Properties

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/core/agent/receipt/receipt.ts:294](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L294)

***

### outputFormat?

> `readonly` `optional` **outputFormat?**: `object`

Defined in: [src/core/agent/receipt/receipt.ts:307](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L307)

The structured-output format the port carried (`LLMRequest.outputFormat`,
`.outputSchema(s, { strategy: 'native' })`): its `type`, and the
run-salted hash of its schema as sorted-key JSON — so a reader can tell
the answer was decoded under a schema, and which one, without the bytes.
Absent when the request carried none.

#### schemaHash

> `readonly` **schemaHash**: `string`

#### type

> `readonly` **type**: `string`

***

### stop?

> `readonly` `optional` **stop?**: readonly `string`[]

Defined in: [src/core/agent/receipt/receipt.ts:297](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L297)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/core/agent/receipt/receipt.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L293)

***

### thinkingBudget?

> `readonly` `optional` **thinkingBudget?**: `number`

Defined in: [src/core/agent/receipt/receipt.ts:296](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L296)

`LLMRequest.thinking.budget` — the reasoning-token ceiling asked for.

***

### toolChoice?

> `readonly` `optional` **toolChoice?**: `object`

Defined in: [src/core/agent/receipt/receipt.ts:299](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L299)

The forced tool choice, as the port carried it.

#### name?

> `readonly` `optional` **name?**: `string`

#### type

> `readonly` **type**: `string`
