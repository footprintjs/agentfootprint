[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeResult

# Interface: CodeResult

Defined in: [src/adapters/types.ts:698](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/adapters/types.ts#L698)

What one execution produced.

## Properties

### artifacts?

> `readonly` `optional` **artifacts?**: readonly `object`[]

Defined in: [src/adapters/types.ts:706](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/adapters/types.ts#L706)

Files the run produced, described rather than inlined — the whole point is
 that big data does not enter the window.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/adapters/types.ts:703](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/adapters/types.ts#L703)

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [src/adapters/types.ts:700](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/adapters/types.ts#L700)

Did the code run to completion without an error exit?

***

### stderr

> `readonly` **stderr**: `string`

Defined in: [src/adapters/types.ts:702](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/adapters/types.ts#L702)

***

### stdout

> `readonly` **stdout**: `string`

Defined in: [src/adapters/types.ts:701](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/adapters/types.ts#L701)

***

### truncated?

> `readonly` `optional` **truncated?**: `object`

Defined in: [src/adapters/types.ts:720](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/adapters/types.ts#L720)

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
