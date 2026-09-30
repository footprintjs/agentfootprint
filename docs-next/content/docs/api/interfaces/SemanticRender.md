---
title: SemanticRender
---

# Interface: SemanticRender

Defined in: [src/lib/semantics/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L138)

Rendering HINTS — the tool never renders. A UI that understands them draws
a better table; one that does not loses nothing, because everything load-
bearing is in the data fields. Dropped from the model's view entirely.

## Properties

### chart\_hint?

> `readonly` `optional` **chart\_hint?**: `string`

Defined in: [src/lib/semantics/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L148)

Chart-shape hint ('line per entity').

***

### columns?

> `readonly` `optional` **columns?**: readonly `string`[]

Defined in: [src/lib/semantics/types.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L142)

Column order for a tabular view.

***

### default

> `readonly` **default**: `string`

Defined in: [src/lib/semantics/types.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L140)

The default presentation ('table', 'chart', 'prose', …). A hint.

***

### filter\_note?

> `readonly` `optional` **filter\_note?**: `string`

Defined in: [src/lib/semantics/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L146)

A note about what filtering already happened ('replicas excluded').

***

### sort?

> `readonly` `optional` **sort?**: `string`

Defined in: [src/lib/semantics/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L144)

Sort hint ('avg_iops desc').
