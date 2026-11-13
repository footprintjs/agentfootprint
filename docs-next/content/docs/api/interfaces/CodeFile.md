---
title: CodeFile
---

# Interface: CodeFile

Defined in: [src/provider-contract/types.ts:1333](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1333)

One file read back out of a code session — exactly as the backend returned it.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1346](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1346)

The size of `data` in bytes (a string's UTF-8 length).

***

### data

> `readonly` **data**: `string` \| `Uint8Array`

Defined in: [src/provider-contract/types.ts:1344](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1344)

The contents. A string when the backend returned TEXT, bytes when it
returned BYTES — decided by which of the two the backend filled, never by
the file's name or extension. A backend that draws no such line
(`localCodeRunner`: a file on disk is bytes) returns bytes, and never
guesses an encoding.

***

### mediaType?

> `readonly` `optional` **mediaType?**: `string`

Defined in: [src/provider-contract/types.ts:1348](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1348)

The backend's own statement of the media type, when it made one. Never guessed.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1336](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1336)

The path that was read, in the canonical form the backend was asked for
 (`./out//a.csv` → `out/a.csv`).
