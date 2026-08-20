[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeInput

# Interface: CodeInput

Defined in: [src/adapters/types.ts:916](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L916)

One payload staged INTO a code session before code runs (9.26.0).

`name` is the file name the caller wants it under — the tool derives it from
the declared argument (`dataset` → `dataset.json`), so the model can be told
the name in a static description. An adapter may sanitize it (a name is
caller data landing in a filesystem) but must not rename it beyond
recognition, because the manifest is keyed by what it was ASKED for.

## Properties

### data

> `readonly` **data**: `string` \| `Uint8Array`

Defined in: [src/adapters/types.ts:935](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L935)

The bytes. A string is written as UTF-8 text; a `Uint8Array` verbatim.

***

### fileName?

> `readonly` `optional` **fileName?**: `string`

Defined in: [src/adapters/types.ts:933](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L933)

The file name to write it under, when it should differ from `name` — the
tool derives one from the artifact's media type (`dataset` +
`application/json` → `dataset.json`) so an interpreter's own loader sees a
familiar extension. Defaults to `name`.

A separate field precisely so the manifest KEY and the on-disk NAME cannot
drift: the code looks up what it was told to look up, whatever the file
ended up being called.

***

### mediaType?

> `readonly` `optional` **mediaType?**: `string`

Defined in: [src/adapters/types.ts:937](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L937)

The producer's own statement about the payload, when it has one.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:922](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L922)

The MANIFEST KEY — what the executing code looks this input up by. The
tool uses the declared argument name (`dataset`), so a static description
can tell the model exactly what to look up before any session exists.
