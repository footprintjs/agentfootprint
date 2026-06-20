---
title: InjectionEngineConfig
---

# Interface: InjectionEngineConfig

Defined in: [src/lib/injection-engine/buildInjectionEngineSubflow.ts:70](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/buildInjectionEngineSubflow.ts#L70)

## Properties

### injections

> `readonly` **injections**: readonly [`Injection`](/docs/api/interfaces/Injection)[]

Defined in: [src/lib/injection-engine/buildInjectionEngineSubflow.ts:76](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/buildInjectionEngineSubflow.ts#L76)

The Injection list. Frozen at build time. To change at runtime,
rebuild the agent / chart — the primitive is intentionally
declarative.

***

### nextSkill?

> `readonly` `optional` **nextSkill?**: (`ctx`) => `string` \| `undefined`

Defined in: [src/lib/injection-engine/buildInjectionEngineSubflow.ts:83](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/buildInjectionEngineSubflow.ts#L83)

The skill-graph CURSOR resolver (`graph.nextSkill`), present only when the
agent was built with `.skillGraph()`. The Evaluate stage advances the cursor
with the SAME `ctx` the triggers gate on, so trigger ↔ cursor never diverge
(the keystone). Absent → `currentSkillId` is never written (no graph routing).

#### Parameters

##### ctx

[`InjectionContext`](/docs/api/interfaces/InjectionContext)

#### Returns

`string` \| `undefined`
