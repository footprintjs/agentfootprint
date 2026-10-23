---
title: SemanticProvenance
---

# Interface: SemanticProvenance

Defined in: [src/semantics/types.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L109)

Where the values came from and how old they are. `measured_at` is when the
WORLD was measured — not when the tool ran; a tool that reads a nightly
export and answers in 4ms is serving yesterday.

## Properties

### age\_seconds?

> `readonly` `optional` **age\_seconds?**: `number`

Defined in: [src/semantics/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L114)

How stale the data was when the tool answered, in seconds.

***

### measured\_at

> `readonly` **measured\_at**: `string`

Defined in: [src/semantics/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L112)

When the world was measured (the tool's own clock words). Required
 whenever the envelope carries `series` or `facts`.

***

### source

> `readonly` **source**: `string`

Defined in: [src/semantics/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L117)

The system of record the values were read from. Required with
 `measured_at`.

***

### source\_export\_date?

> `readonly` `optional` **source\_export\_date?**: `string`

Defined in: [src/semantics/types.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L119)

For file-fed collectors: the export the values rode in on.
