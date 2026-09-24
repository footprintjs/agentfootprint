[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ServedView

# Interface: ServedView

Defined in: [src/lib/time-travel/servedView.ts:773](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L773)

THE SERVED VIEW: what the model was handed on one epoch, rebuilt.

A SERVED VIEW IS A VALUE. The whole of it is frozen — the object, its four
sub-objects and all six containers, down to the pieces and gaps it holds —
so the `readonly` on every field below is a fact and not a hint. Two of those
containers are also COPIES (`messages.asSent`, `tools.schemas`), because
those alone would otherwise alias the fold's memoized answers; see
`detachedList`. Copy before you edit: `structuredClone`, or a spread.

## Example

```ts
import { servedAt } from 'agentfootprint';

const view = servedAt(agent.getSnapshot()!, 1)!;
view.system.text;            // the joined system prompt, as sent
view.messages.asSent.length; // the turns that went out
view.tools.names;            // including a forced answer tool
view.basis?.model;           // which model saw it
view.gaps.map((g) => g.gap); // ['cache-transform', 'provider-defaults'] on an agent
```

## Properties

### basis?

> `readonly` `optional` **basis?**: `object`

Defined in: [src/lib/time-travel/servedView.ts:810](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L810)

WHICH MODEL SAW THIS, and through which provider — read off the receipt's
own `basis`, which is the only place the run records them.

Absent when this epoch's call left no receipt for the read to find. The
absence is DECLARED, not left to be noticed: `gaps` then carries
`no-receipt-on-chart`, which names this field, and that gap's
[ServedGap.cause](/agentfootprint/api/generated/interfaces/ServedGap.md#cause) carries what the read established — the receipt key
held nothing, or held something that is not a receipt. The sentence itself
does not tell those apart and used to claim it did; a frozen sentence
cannot, which is why the fact is a field.

It is the one field on this view that does not come from the rebuild, and
it is here because a served view without it cannot answer "what did THIS
model read" — only "what did something read". It is deliberately not part
of the conformance law: there is no committed counterpart to check it
against.

#### model

> `readonly` **model**: `string`

#### provider

> `readonly` **provider**: `string`

#### runId

> `readonly` **runId**: `string`

The salt every hash on this epoch's receipt was taken with.

#### Example

```ts
import { servedAt } from 'agentfootprint';

const view = servedAt(agent.getSnapshot()!, 1)!;
`${view.basis?.model ?? 'unknown model'} read ${view.system.text.length} chars`;
```

***

### callRuntimeStageId

> `readonly` **callRuntimeStageId**: `string`

Defined in: [src/lib/time-travel/servedView.ts:783](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L783)

***

### epoch

> `readonly` **epoch**: `number`

Defined in: [src/lib/time-travel/servedView.ts:782](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L782)

WHICH TURN THIS IS, as the fold read it — the run's own committed
`iteration`, and its POSITION in run order when the fold could not read
that (`EpochLocation.epoch`). `servedAt(k)` hands `k` back either way;
`servedViews()` returns the fold's number outright, so a base-less
recording can number a turn differently from the receipt that turn minted.
`gaps` carries `no-fold-base` exactly when that is possible.

***

### gaps

> `readonly` **gaps**: readonly [`ServedGap`](/agentfootprint/api/generated/interfaces/ServedGap.md)[]

Defined in: [src/lib/time-travel/servedView.ts:841](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L841)

What this rebuild could NOT recover, each naming the receipt field it
 explains. Never empty — see [SERVED\_GAPS](/agentfootprint/api/generated/variables/SERVED_GAPS.md).

***

### messages

> `readonly` **messages**: `object`

Defined in: [src/lib/time-travel/servedView.ts:820](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L820)

#### asSent

> `readonly` **asSent**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

The conversation as it went out, post-strip, in wire order. FROZEN, and
 so are its messages: they come from a fold whose answers seed every
 later epoch's — see `keyedFold.ts` · `freezeDeep`. Copy to edit.

#### requestOnly

> `readonly` **requestOnly**: readonly [`ServedRequestOnly`](/agentfootprint/api/generated/interfaces/ServedRequestOnly.md)[]

Lines composed for this request and written to no history.

***

### system

> `readonly` **system**: `object`

Defined in: [src/lib/time-travel/servedView.ts:816](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L816)

#### pieces

> `readonly` **pieces**: readonly [`ServedPiece`](/agentfootprint/api/generated/interfaces/ServedPiece.md)[]

#### text

> `readonly` **text**: `string`

***

### tools

> `readonly` **tools**: `object`

Defined in: [src/lib/time-travel/servedView.ts:828](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L828)

#### forced?

> `readonly` `optional` **forced?**: `string`

The tool the model was forced to answer through.

#### names

> `readonly` **names**: readonly `string`[]

Every tool name on the request, forced answer tool included.

#### schemas

> `readonly` **schemas**: readonly [`LLMToolSchema`](/agentfootprint/api/generated/interfaces/LLMToolSchema.md)[]

The schemas the log holds. Short of `names` by the forced tool — see
 [SERVED\_GAPS](/agentfootprint/api/generated/variables/SERVED_GAPS.md). FROZEN, for the same reason `asSent` is.

#### withheld?

> `readonly` `optional` **withheld?**: `"wrap-up"`

Why the tool list is empty when it would not otherwise be.
