---
title: SkillToolPair
---

# Interface: SkillToolPair

Defined in: [src/lib/injection-engine/skillTools.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillTools.ts#L149)

The pair returned by `SkillRegistry.toTools()`. Either entry may be
undefined when the registry is empty. Consumers typically destructure:

  const { listSkills, readSkill } = registry.toTools();
  const tools = [listSkills, readSkill, ...other].filter(Boolean) as Tool[];

## Properties

### listSkills

> `readonly` **listSkills**: [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`

Defined in: [src/lib/injection-engine/skillTools.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillTools.ts#L151)

The `list_skills` tool, or `undefined` if registry is empty.

***

### readSkill

> `readonly` **readSkill**: [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`

Defined in: [src/lib/injection-engine/skillTools.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillTools.ts#L153)

The `read_skill` tool, or `undefined` if registry is empty.
