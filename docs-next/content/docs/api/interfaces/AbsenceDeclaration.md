---
title: AbsenceDeclaration
---

# Interface: AbsenceDeclaration

Defined in: [src/core/agent/coverage/types.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L122)

What a tool author passes to import('./absent.js').absent.

## Properties

### cannotCover?

> `readonly` `optional` **cannotCover?**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/core/agent/coverage/types.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L140)

Ground no search by this tool can reach. Each needs a `why`.

***

### checked

> `readonly` **checked**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/core/agent/coverage/types.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L135)

The coverage of the search — REQUIRED and non-empty. An absence that
names no coverage is a `null` with extra steps: the reader still cannot
tell "I looked and there is nothing" from "I could not look", which is
the entire failure this primitive exists to prevent.

***

### notChecked?

> `readonly` `optional` **notChecked?**: readonly [`CoverageInput`](/docs/api/type-aliases/CoverageInput)[]

Defined in: [src/core/agent/coverage/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L138)

Ground the search did not reach this time — an absence here proves
 nothing about it.

***

### tryInstead?

> `readonly` `optional` **tryInstead?**: `string`

Defined in: [src/core/agent/coverage/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L151)

Where to go INSTEAD, in one sentence ("widen the window with
`window: '7d'`, or ask for a different interface"). Optional, and the
highest-value optional field in the shape: the loop this primitive stops
is a model with nowhere else to go.

Prose for the model. Nothing in this library reads a tool name out of it:
when the sentence points at another tool, name that tool in
[AbsenceDeclaration.tryInsteadTool](/docs/api/interfaces/AbsenceDeclaration#tryinsteadtool) as well.

***

### tryInsteadTool?

> `readonly` `optional` **tryInsteadTool?**: [`TryInsteadTool`](/docs/api/interfaces/TryInsteadTool)

Defined in: [src/core/agent/coverage/types.ts:161](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L161)

The other TOOL the suggestion points at, as data (9.113.0) —
`{ tool, why? }`. Beside the sentence, not instead of it: the sentence is
what the model is told, this is what a reader reads without parsing
prose. Either may be given without the other; when both are given they
must name the same tool, and the library cannot check that they do — it
would have to read a tool name out of the sentence. ONE tool; a list is
refused (see `absent.ts` · `readToolSuggestion` for why).

***

### what

> `readonly` **what**: `string`

Defined in: [src/core/agent/coverage/types.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L128)

What was looked for, in the author's own words ("FLOGI entries on
fc1/3"). Required: an absence that cannot say what it did not find is
indistinguishable from a tool that returned nothing by accident.
