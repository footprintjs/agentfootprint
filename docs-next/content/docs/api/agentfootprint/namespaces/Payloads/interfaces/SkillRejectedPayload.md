---
title: SkillRejectedPayload
---

# Interface: SkillRejectedPayload

Defined in: [src/events/payloads.ts:475](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L475)

Fired by the skill-graph read_skill GATE when the model tries to `read_skill`
a skill that is NOT reachable from the current cursor. The jump is rejected
(cursor/activations unchanged); the model gets a synthetic re-prompt naming
`allowed`. Powers the lens / Why-panel "it tried to leave the graph here".

## Properties

### allowed

> `readonly` **allowed**: readonly `string`[]

Defined in: [src/events/payloads.ts:481](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L481)

The reachable set it was bounded to (what the re-prompt offered).

***

### currentSkillId?

> `readonly` `optional` **currentSkillId?**: `string`

Defined in: [src/events/payloads.ts:479](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L479)

The cursor it was at (undefined = cold start, before any entry resolved).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:483](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L483)

The ReAct iteration the rejection fired on.

***

### requestedId

> `readonly` **requestedId**: `string`

Defined in: [src/events/payloads.ts:477](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L477)

The skill id the model requested via `read_skill`.
