---
title: toolDigestInput
---

# Function: toolDigestInput()

> **toolDigestInput**(`tool`): `string`

Defined in: [src/lib/time-travel/receipt.ts:471](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L471)

The bytes a tool schema's hash covers: the whole `LLMToolSchema` — `name`,
`description`, `inputSchema` — as sorted-key JSON, so two schemas that are
structurally the same hash the same however they were built, and with a
schema JSON cannot express (a cycle, a `BigInt`) marked UNSERIALIZABLE
rather than dropped or thrown on.

WHAT TO PASS (9.89.0). The receipt hashes each tool AS HANDED TO THE PORT:
`buildReceipt` is given the request's tool list, and that list is the
`dynamicToolSchemas` the run committed, plus a forced answer tool when an
output strategy adds one. `servedAt(k).tools.schemas[i]` is that committed
list read back — the same shape, the same bytes — so a consumer holding a
served view already holds the object this function takes. It does not take
the served view, a `Tool`, or a `defineTool` definition: those carry an
`execute`, `wants` and other fields the model never saw.

WHY IT IS EXPORTED. A reader that rebuilds a served view proves the rebuild
by hashing it the way the receipt did. `receiptHash` and `messageDigestInput`
were exported in 9.88.0 for the system text, the pieces and the messages,
and a consumer could verify all of them — and NOT the tools, because the
serializer behind `schemaHashes` was internal. Its only options were to copy
`stableJson` (a second owner of the rule, which drifts the day the digest
gains a field, as the message digest did in 9.88.0) or to leave the schema
rows unverified. This is the third digest half of the law, beside its two
siblings, and the ONLY spelling of the schema rule: `buildReceipt` calls it
too. `stableJson` stays off the root barrel for the same reason — a consumer
composing `hash(stableJson(tool))` would be writing the rule a second time.

## Parameters

### tool

[`LLMToolSchema`](/docs/api/interfaces/LLMToolSchema)

## Returns

`string`

## Example

**verify every schema row of a receipt from outside**

```ts
import { receiptAt, receiptHash, servedAt, toolDigestInput } from 'agentfootprint';

const snapshot = agent.getSnapshot()!;
const view = servedAt(snapshot, 1)!;
const receipt = receiptAt(snapshot, 1)!;
for (const tool of view.tools.schemas) {
  receiptHash(receipt.basis.runId, toolDigestInput(tool)) ===
    receipt.tools.schemaHashes[tool.name]; // true, for every tool of every epoch
}
// A forced answer tool is in `schemaHashes` and NOT in `schemas` — its body
// is a declared gap (`forced-tool-schema`), so there is no row to check.
```
