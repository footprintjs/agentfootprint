[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ActKey

# Type Alias: ActKey\<M\>

> **ActKey**\<`M`\> = `M` *extends* `` `${infer Head}-${infer Tail}` `` ? `` `${Head}${Capitalize<Tail>}` `` : `M`

Defined in: [src/core/agent/moments.ts:52](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/moments.ts#L52)

The `.act()` key that governs a moment: the moment's name, camel-cased.

`'before-tool'` → `beforeTool`. Purely mechanical, so there is no list of
pairs anywhere for the two spellings to drift apart in.

## Type Parameters

### M

`M` *extends* [`LoopMoment`](/agentfootprint/api/generated/type-aliases/LoopMoment.md) = [`LoopMoment`](/agentfootprint/api/generated/type-aliases/LoopMoment.md)
