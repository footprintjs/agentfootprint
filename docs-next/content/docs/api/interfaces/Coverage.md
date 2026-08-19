---
title: Coverage
---

# Interface: Coverage

Defined in: [src/core/agent/coverage/types.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L53)

The three lists, normalized. This is the shape everything downstream reads —
the renderer, the event payload, the answer-level block.

The three are NOT interchangeable, and the difference is the whole point:

  • `checked` — ground this result actually stands on. A clean verdict here
    means VERIFIED.
  • `notChecked` — ground this run could have covered and did not (budget,
    a timeout, a scope the caller chose). A clean verdict says nothing
    about it. Re-asking with a wider scope can move it to `checked`.
  • `cannotCover` — ground no call to this tool will ever reach (no
    collector, no permission, no such telemetry). A clean verdict says
    nothing about it, and no retry ever will. This is the list that turns
    "everything looks fine" into "everything I can see looks fine".

## Extended by

- [`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage)

## Properties

### cannotCover

> `readonly` **cannotCover**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L56)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L54)

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L55)
