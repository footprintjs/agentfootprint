[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SemanticProvenance

# Interface: SemanticProvenance

Defined in: [src/lib/semantics/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L107)

Where the values came from and how old they are. `measured_at` is when the
WORLD was measured — not when the tool ran; a tool that reads a nightly
export and answers in 4ms is serving yesterday.

## Properties

### age\_seconds?

> `readonly` `optional` **age\_seconds?**: `number`

Defined in: [src/lib/semantics/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L112)

How stale the data was when the tool answered, in seconds.

***

### measured\_at

> `readonly` **measured\_at**: `string`

Defined in: [src/lib/semantics/types.ts:110](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L110)

When the world was measured (the tool's own clock words). Required
 whenever the envelope carries `series` or `facts`.

***

### source

> `readonly` **source**: `string`

Defined in: [src/lib/semantics/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L115)

The system of record the values were read from. Required with
 `measured_at`.

***

### source\_export\_date?

> `readonly` `optional` **source\_export\_date?**: `string`

Defined in: [src/lib/semantics/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L117)

For file-fed collectors: the export the values rode in on.
