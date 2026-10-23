---
title: KnownNames
---

# Interface: KnownNames

Defined in: [src/semantics/coverage/types.ts:319](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L319)

`known_names` on an `among` absence — what the model may know of the list.
The count always; the nearest names only when the declaration said
`visible: 'caller'`. MODEL-ONLY: it rides the served value and so the
conversation, and no event field (`stream.tool_end` loses it,
`tools.absent` never had it).

## Properties

### count

> `readonly` **count**: `number`

Defined in: [src/semantics/coverage/types.ts:320](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L320)

***

### dropped?

> `readonly` `optional` **dropped?**: `number`

Defined in: [src/semantics/coverage/types.ts:324](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L324)

How many names were left out as unprintable or over `MAX_NAME_CHARS`.

***

### nearest?

> `readonly` `optional` **nearest?**: readonly `string`[]

Defined in: [src/semantics/coverage/types.ts:322](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L322)

At most `KNOWN_NAMES_SHOWN` names, nearest the looked-for value first.
