---
title: AttributionUnit
---

# Interface: AttributionUnit

Defined in: src/lib/influence-core/types.ts:300

One piece of the context the chooser saw, tagged by which channel it
came from. `scoreMargin` asks "which tool best fits ONE context";
`attributeChoice` asks the transpose — "which context UNIT best explains
ONE chosen tool" — so the unit is the thing being scored here.

A channel groups units by origin so the attribution can report where the
pull came from: `'system'` (a rule in the system prompt), `'task'` (the
user's request), `'result'` (data a prior tool returned), `'history'`
(an earlier turn). Channels are free-form strings — the caller decides
the taxonomy; the engine only sums by whatever labels it is given.

(Named `AttributionUnit`, not `ContextUnit`, to stay distinct from
context-bisect's own `ContextUnit`, which is a different subsystem.)

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: src/lib/influence-core/types.ts:304

Origin group, e.g. `'system' | 'task' | 'result' | 'history'`.

***

### id

> `readonly` **id**: `string`

Defined in: src/lib/influence-core/types.ts:302

Unique id — the citation the attribution points at, e.g. `'rule-1'`.

***

### text

> `readonly` **text**: `string`

Defined in: src/lib/influence-core/types.ts:306

The text of the unit (a rule sentence, the user task, …).
