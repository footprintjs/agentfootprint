---
title: InjectionContent
---

# Interface: InjectionContent

Defined in: [src/lib/injection-engine/types.ts:61](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/types.ts#L61)

Multi-slot per Injection. A Skill for example targets BOTH
system-prompt (the body) AND tools (the unlocked capabilities)
in one Injection. Lens displays the same Injection chip across
each slot it lands in.

## Properties

### messages?

> `readonly` `optional` **messages?**: readonly `object`[]

Defined in: [src/lib/injection-engine/types.ts:65](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/types.ts#L65)

Messages prepended to the messages slot when active.

***

### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: [src/lib/injection-engine/types.ts:63](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/types.ts#L63)

Text appended to the system-prompt slot when active.

***

### tools?

> `readonly` `optional` **tools?**: readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

Defined in: [src/lib/injection-engine/types.ts:70](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/types.ts#L70)

Tools added to the tools slot when active.
