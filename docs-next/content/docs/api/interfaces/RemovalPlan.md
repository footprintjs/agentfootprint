---
title: RemovalPlan
---

# Interface: RemovalPlan

Defined in: src/core/agent/window/turns.ts:126

The span a removal will take, plus every refusal it had to name to get there.

## Properties

### from

> `readonly` **from**: `number`

Defined in: src/core/agent/window/turns.ts:128

First turn index in the span; -1 when nothing may be removed.

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/docs/api/interfaces/WindowRefusal)[]

Defined in: src/core/agent/window/turns.ts:131

***

### to

> `readonly` **to**: `number`

Defined in: src/core/agent/window/turns.ts:130

Last turn index in the span (inclusive); -1 when nothing may be removed.
