---
title: explainSemantics
---

# Function: explainSemantics()

> **explainSemantics**(`value`): readonly [`SemanticIssue`](/docs/api/interfaces/SemanticIssue)[] \| `undefined`

Defined in: [src/lib/semantics/envelope.ts:777](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/envelope.ts#L777)

Name what is wrong with a value that CARRIES the marker but was not
recognized. `undefined` for values without the marker (they are data, not
near-misses) and for well-formed envelopes. Diagnosis only — never changes
what any value does.

## Parameters

### value

`unknown`

## Returns

readonly [`SemanticIssue`](/docs/api/interfaces/SemanticIssue)[] \| `undefined`
