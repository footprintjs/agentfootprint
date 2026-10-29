---
title: ToolScript
---

# Interface: ToolScript

Defined in: [src/tools/script.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/script.ts#L43)

Where a code-running tool's program travels, and its language.

## Properties

### argument

> `readonly` **argument**: `string`

Defined in: [src/tools/script.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/script.ts#L45)

The ONE string argument of the input schema that carries the program.

***

### language?

> `readonly` `optional` **language?**: `string`

Defined in: [src/tools/script.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/script.ts#L52)

The program's language — the info string of the fence the library renders
the program in (`python`, `sql`). One plain token: no line break, no
backtick (a backtick fence's info string may not hold one), at most 64
characters. Absent → a fence with no info string.
