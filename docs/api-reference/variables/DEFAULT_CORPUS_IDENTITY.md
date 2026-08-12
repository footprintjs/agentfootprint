[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DEFAULT\_CORPUS\_IDENTITY

# Variable: DEFAULT\_CORPUS\_IDENTITY

> `const` **DEFAULT\_CORPUS\_IDENTITY**: `MemoryIdentity`

Defined in: [src/lib/rag/defineRAG.ts:137](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/lib/rag/defineRAG.ts#L137)

The namespace a corpus lives in unless told otherwise — the same one
`indexDocuments` writes to by default. The two defaults are one value
on purpose: index with no options, retrieve with no options, and the
documents are found.
