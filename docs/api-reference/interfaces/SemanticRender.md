[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SemanticRender

# Interface: SemanticRender

Defined in: [src/lib/semantics/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L137)

Rendering HINTS — the tool never renders. A UI that understands them draws
a better table; one that does not loses nothing, because everything load-
bearing is in the data fields. Dropped from the model's view entirely.

## Properties

### chart\_hint?

> `readonly` `optional` **chart\_hint?**: `string`

Defined in: [src/lib/semantics/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L147)

Chart-shape hint ('line per entity').

***

### columns?

> `readonly` `optional` **columns?**: readonly `string`[]

Defined in: [src/lib/semantics/types.ts:141](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L141)

Column order for a tabular view.

***

### default

> `readonly` **default**: `string`

Defined in: [src/lib/semantics/types.ts:139](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L139)

The default presentation ('table', 'chart', 'prose', …). A hint.

***

### filter\_note?

> `readonly` `optional` **filter\_note?**: `string`

Defined in: [src/lib/semantics/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L145)

A note about what filtering already happened ('replicas excluded').

***

### sort?

> `readonly` `optional` **sort?**: `string`

Defined in: [src/lib/semantics/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L143)

Sort hint ('avg_iops desc').
