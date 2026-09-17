---
title: CodeInput
---

# Interface: CodeInput

Defined in: [src/adapters/types.ts:1019](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1019)

One payload staged INTO a code session before code runs (9.26.0).

`name` is the file name the caller wants it under — the tool derives it from
the declared argument (`dataset` → `dataset.json`), so the model can be told
the name in a static description. An adapter may sanitize it (a name is
caller data landing in a filesystem) but must not rename it beyond
recognition, because the manifest is keyed by what it was ASKED for.

## Properties

### data

> `readonly` **data**: `string` \| `Uint8Array`

Defined in: [src/adapters/types.ts:1038](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1038)

The bytes. A string is written as UTF-8 text; a `Uint8Array` verbatim.

***

### fileName?

> `readonly` `optional` **fileName?**: `string`

Defined in: [src/adapters/types.ts:1036](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1036)

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

Defined in: [src/adapters/types.ts:1040](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1040)

The producer's own statement about the payload, when it has one.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:1025](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1025)

The MANIFEST KEY — what the executing code looks this input up by. The
tool uses the declared argument name (`dataset`), so a static description
can tell the model exactly what to look up before any session exists.
