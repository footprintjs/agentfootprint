[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeInput

# Interface: CodeInput

Defined in: [src/adapters/types.ts:1065](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/types.ts#L1065)

One payload staged INTO a code session before code runs (9.26.0).

`name` is the file name the caller wants it under — the tool derives it from
the declared argument (`dataset` → `dataset.json`), so the model can be told
the name in a static description. An adapter may sanitize it (a name is
caller data landing in a filesystem) but must not rename it beyond
recognition, because the manifest is keyed by what it was ASKED for.

## Properties

### data

> `readonly` **data**: `string` \| `Uint8Array`

Defined in: [src/adapters/types.ts:1084](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/types.ts#L1084)

The bytes. A string is written as UTF-8 text; a `Uint8Array` verbatim.

***

### fileName?

> `readonly` `optional` **fileName?**: `string`

Defined in: [src/adapters/types.ts:1082](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/types.ts#L1082)

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

Defined in: [src/adapters/types.ts:1086](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/types.ts#L1086)

The producer's own statement about the payload, when it has one.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:1071](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/types.ts#L1071)

The MANIFEST KEY — what the executing code looks this input up by. The
tool uses the declared argument name (`dataset`), so a static description
can tell the model exactly what to look up before any session exists.
