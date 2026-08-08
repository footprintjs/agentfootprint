[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RetrievedCandidate

# Interface: RetrievedCandidate

Defined in: [src/memory/retrieval/types.ts:58](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L58)

One candidate the retrieval considered — admitted or not.

`rank` is the candidate's position by SCORE (1-based, descending),
which is not necessarily the order it appears in the prompt: the
budget picker admits by recency (see [RetrievalEvidence.selectionOrder](/agentfootprint/api/generated/interfaces/RetrievalEvidence.md#selectionorder)).
Recording both is the point — a reader can see that the best-scoring
chunk was admitted third, and know that was the picker's doing.

## Properties

### admitted

> `readonly` **admitted**: `boolean`

Defined in: [src/memory/retrieval/types.ts:66](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L66)

Did this candidate's text reach the prompt?

***

### docUri?

> `readonly` `optional` **docUri?**: `string`

Defined in: [src/memory/retrieval/types.ts:70](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L70)

Source document, when the indexed value carried one in its metadata.

***

### heading?

> `readonly` `optional` **heading?**: `string`

Defined in: [src/memory/retrieval/types.ts:74](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L74)

Section heading, when the splitter knew one.

***

### id

> `readonly` **id**: `string`

Defined in: [src/memory/retrieval/types.ts:60](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L60)

The store entry's id. For an indexed corpus this is the chunk id.

***

### page?

> `readonly` `optional` **page?**: `number`

Defined in: [src/memory/retrieval/types.ts:72](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L72)

Page number, when the loader knew one (PDFs).

***

### promptFragment?

> `readonly` `optional` **promptFragment?**: `string`

Defined in: [src/memory/retrieval/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L83)

The exact prompt bytes this chunk contributed, set by the formatter
for admitted candidates. Joining every admitted candidate's fragment
**in [promptPosition](/agentfootprint/api/generated/interfaces/RetrievedCandidate.md#promptposition) order** with `\n\n` reproduces the
injected message exactly — which is what lets one retrieval become
one `InjectionRecord` PER CHUNK without changing a single byte the
model sees.

***

### promptPosition?

> `readonly` `optional` **promptPosition?**: `number`

Defined in: [src/memory/retrieval/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L94)

Where this chunk sat in the injected message, 0-based.

NOT the same as [rank](/agentfootprint/api/generated/interfaces/RetrievedCandidate.md#rank), and the difference is the honest part:
`rank` is how well the chunk scored, `promptPosition` is where the
budget picker put it. Under the default recency ordering the
best-scoring chunk can land last — which is exactly the kind of thing
a lost-in-the-middle investigation needs to be able to see, and which
a record that only kept one of the two orders could not show.

***

### rank

> `readonly` **rank**: `number`

Defined in: [src/memory/retrieval/types.ts:64](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L64)

1-based position by score, descending, across the whole candidate pool.

***

### reason?

> `readonly` `optional` **reason?**: [`RetrievalRejectReason`](/agentfootprint/api/generated/type-aliases/RetrievalRejectReason.md)

Defined in: [src/memory/retrieval/types.ts:68](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L68)

Present exactly when `admitted` is false.

***

### score

> `readonly` **score**: `number`

Defined in: [src/memory/retrieval/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/memory/retrieval/types.ts#L62)

Similarity as the store reported it. Cosine ([-1, 1]) for every shipped store.
