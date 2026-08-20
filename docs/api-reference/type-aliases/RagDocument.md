[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RagDocument

# Type Alias: RagDocument

> **RagDocument** = \{ `content`: `string`; `id`: `string`; `metadata?`: `Readonly`\<`Record`\<`string`, `unknown`\>\>; `text?`: `string`; \} \| \{ `content?`: `string`; `id`: `string`; `metadata?`: `Readonly`\<`Record`\<`string`, `unknown`\>\>; `text`: `string`; \}

Defined in: [src/lib/rag/indexDocuments.ts:51](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/rag/indexDocuments.ts#L51)

A document to index. `id` must be unique within the store + identity.

The passage rides on `content`. Since 8.19.0 `text` is accepted as the
same thing, because the retrieval formatter reads both keys and a
hand-built entry that spelled it `text` used to index and retrieve
perfectly while rendering an EMPTY passage. One sane meaning, two
spellings, and `indexDocuments` refuses a document carrying NEITHER —
an unrenderable passage and an absent one are different facts.

## Union Members

### Type Literal

\{ `content`: `string`; `id`: `string`; `metadata?`: `Readonly`\<`Record`\<`string`, `unknown`\>\>; `text?`: `string`; \}

#### content

> `readonly` **content**: `string`

The passage. Use this one; `text` is the accepted alias.

#### id

> `readonly` **id**: `string`

#### metadata?

> `readonly` `optional` **metadata?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

#### text?

> `readonly` `optional` **text?**: `string`

***

### Type Literal

\{ `content?`: `string`; `id`: `string`; `metadata?`: `Readonly`\<`Record`\<`string`, `unknown`\>\>; `text`: `string`; \}

#### content?

> `readonly` `optional` **content?**: `string`

#### id

> `readonly` **id**: `string`

#### metadata?

> `readonly` `optional` **metadata?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

#### text

> `readonly` **text**: `string`

The passage, spelled the way a `Chunk` spells it. Accepted so a
corpus assembled by hand from `rag`-door chunks indexes without a
rename. `content` wins when both are present.
