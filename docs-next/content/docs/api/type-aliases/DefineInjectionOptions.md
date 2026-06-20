---
title: DefineInjectionOptions
---

# Type Alias: DefineInjectionOptions

> **DefineInjectionOptions** = `object` & [`DefineInstructionOptions`](/docs/api/interfaces/DefineInstructionOptions) \| `object` & [`DefineSkillOptions`](/docs/api/interfaces/DefineSkillOptions) \| `object` & [`DefineSteeringOptions`](/docs/api/interfaces/DefineSteeringOptions) \| `object` & [`DefineFactOptions`](/docs/api/interfaces/DefineFactOptions)

Defined in: [src/lib/injection-engine/factories/defineInjection.ts:32](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/factories/defineInjection.ts#L32)

Discriminated union — `type` picks the flavor; the rest are that flavor's options.
