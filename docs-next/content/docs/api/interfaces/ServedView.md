---
title: ServedView
---

# Interface: ServedView

Defined in: [src/lib/time-travel/servedView.ts:710](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L710)

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
view.gaps.map((g) => g.gap); // ['cache-transform', 'provider-defaults']
```

## Properties

### basis?

> `readonly` `optional` **basis?**: `object`

Defined in: [src/lib/time-travel/servedView.ts:747](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L747)

WHICH MODEL SAW THIS, and through which provider — read off the receipt's
own `basis`, which is the only place the run records them.

Absent when this epoch's call left no receipt for the read to find. The
absence is DECLARED, not left to be noticed: `gaps` then carries
`no-receipt-on-chart`, which names this field, and that gap's
[ServedGap.cause](/docs/api/interfaces/ServedGap#cause) carries what the read established — the receipt key
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

Defined in: [src/lib/time-travel/servedView.ts:720](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L720)

***

### epoch

> `readonly` **epoch**: `number`

Defined in: [src/lib/time-travel/servedView.ts:719](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L719)

WHICH TURN THIS IS, as the fold read it — the run's own committed
`iteration`, and its POSITION in run order when the fold could not read
that (`EpochLocation.epoch`). `servedAt(k)` hands `k` back either way;
`servedViews()` returns the fold's number outright, so a base-less
recording can number a turn differently from the receipt that turn minted.
`gaps` carries `no-fold-base` exactly when that is possible.

***

### gaps

> `readonly` **gaps**: readonly [`ServedGap`](/docs/api/interfaces/ServedGap)[]

Defined in: [src/lib/time-travel/servedView.ts:778](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L778)

What this rebuild could NOT recover, each naming the receipt field it
 explains. Never empty — see [SERVED\_GAPS](/docs/api/variables/SERVED_GAPS).

***

### messages

> `readonly` **messages**: `object`

Defined in: [src/lib/time-travel/servedView.ts:757](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L757)

#### asSent

> `readonly` **asSent**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

The conversation as it went out, post-strip, in wire order. FROZEN, and
 so are its messages: they come from a fold whose answers seed every
 later epoch's — see `keyedFold.ts` · `freezeDeep`. Copy to edit.

#### requestOnly

> `readonly` **requestOnly**: readonly [`ServedRequestOnly`](/docs/api/interfaces/ServedRequestOnly)[]

Lines composed for this request and written to no history.

***

### system

> `readonly` **system**: `object`

Defined in: [src/lib/time-travel/servedView.ts:753](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L753)

#### pieces

> `readonly` **pieces**: readonly [`ServedPiece`](/docs/api/interfaces/ServedPiece)[]

#### text

> `readonly` **text**: `string`

***

### tools

> `readonly` **tools**: `object`

Defined in: [src/lib/time-travel/servedView.ts:765](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L765)

#### forced?

> `readonly` `optional` **forced?**: `string`

The tool the model was forced to answer through.

#### names

> `readonly` **names**: readonly `string`[]

Every tool name on the request, forced answer tool included.

#### schemas

> `readonly` **schemas**: readonly [`LLMToolSchema`](/docs/api/interfaces/LLMToolSchema)[]

The schemas the log holds. Short of `names` by the forced tool — see
 [SERVED\_GAPS](/docs/api/variables/SERVED_GAPS). FROZEN, for the same reason `asSent` is.

#### withheld?

> `readonly` `optional` **withheld?**: `"wrap-up"`

Why the tool list is empty when it would not otherwise be.
