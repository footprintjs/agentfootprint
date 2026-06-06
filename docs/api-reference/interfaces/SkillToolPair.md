[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SkillToolPair

# Interface: SkillToolPair

Defined in: [src/lib/injection-engine/skillTools.ts:149](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/skillTools.ts#L149)

The pair returned by `SkillRegistry.toTools()`. Either entry may be
undefined when the registry is empty. Consumers typically destructure:

  const { listSkills, readSkill } = registry.toTools();
  const tools = [listSkills, readSkill, ...other].filter(Boolean) as Tool[];

## Properties

### listSkills

> `readonly` **listSkills**: [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`

Defined in: [src/lib/injection-engine/skillTools.ts:151](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/skillTools.ts#L151)

The `list_skills` tool, or `undefined` if registry is empty.

***

### readSkill

> `readonly` **readSkill**: [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`

Defined in: [src/lib/injection-engine/skillTools.ts:153](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/skillTools.ts#L153)

The `read_skill` tool, or `undefined` if registry is empty.
