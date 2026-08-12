[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeResult

# Interface: CodeResult

Defined in: [src/adapters/types.ts:798](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/adapters/types.ts#L798)

What one execution produced.

## Properties

### artifacts?

> `readonly` `optional` **artifacts?**: readonly `object`[]

Defined in: [src/adapters/types.ts:806](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/adapters/types.ts#L806)

Files the run produced, described rather than inlined — the whole point is
 that big data does not enter the window.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/adapters/types.ts:803](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/adapters/types.ts#L803)

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [src/adapters/types.ts:800](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/adapters/types.ts#L800)

Did the code run to completion without an error exit?

***

### stderr

> `readonly` **stderr**: `string`

Defined in: [src/adapters/types.ts:802](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/adapters/types.ts#L802)

***

### stdout

> `readonly` **stdout**: `string`

Defined in: [src/adapters/types.ts:801](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/adapters/types.ts#L801)

***

### truncated?

> `readonly` `optional` **truncated?**: `object`

Defined in: [src/adapters/types.ts:820](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/adapters/types.ts#L820)

Present IFF output was cut, and then it says by how much.

Load-bearing, not politeness. A runner exists so big data is computed
outside the context window instead of pasted into it; a runner that
quietly slices its own output to fit is the same bug wearing a different
hat, and the model would go on to reason over a truncated table it was
never told was truncated. An unstated slice is a silent success.

#### ofChars?

> `readonly` `optional` **ofChars?**: `number`

The pre-truncation length, in characters, of whichever stream was cut.

#### stderr?

> `readonly` `optional` **stderr?**: `boolean`

#### stdout?

> `readonly` `optional` **stdout?**: `boolean`
