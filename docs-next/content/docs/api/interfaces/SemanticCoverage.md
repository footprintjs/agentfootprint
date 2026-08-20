---
title: SemanticCoverage
---

# Interface: SemanticCoverage

Defined in: [src/lib/semantics/types.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L160)

The envelope's coverage, normalized — the SAME three-list vocabulary the
`coverage()` / `absent()` primitives speak (checked / not checked / cannot
cover), in the snake_case spelling every rendered tool shape uses because
a model reads it more often than code does. Declared through
[SemanticDeclaration.coverage](/docs/api/interfaces/SemanticDeclaration#coverage) with the exact `CoverageDeclaration`
input the `coverage()` primitive takes; the dispatch loop declares it
through the same channel (`tools.coverage_declared`, tracked state, the
final-answer limits block) — absorbed, never duplicated.

## Properties

### cannot\_cover?

> `readonly` `optional` **cannot\_cover?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/lib/semantics/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L163)

***

### checked?

> `readonly` `optional` **checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/lib/semantics/types.ts:161](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L161)

***

### not\_checked?

> `readonly` `optional` **not\_checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/lib/semantics/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L162)
