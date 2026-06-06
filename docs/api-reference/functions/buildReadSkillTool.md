[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / buildReadSkillTool

# Function: buildReadSkillTool()

> **buildReadSkillTool**(`skills`): [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`

Defined in: [src/lib/injection-engine/skillTools.ts:84](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/skillTools.ts#L84)

Build the `read_skill` tool — activates a skill for the next
iteration. The LLM picks WHICH skill via the `id` argument.

Tool execute() returns a confirmation string. The actual bookkeeping
(appending the requested skill id to `scope.activatedInjectionIds`)
is handled by the Agent's tool-calls subflow, which inspects every
`read_skill` tool call by name. The next iteration's InjectionEngine
matches Skills with `trigger.kind: 'llm-activated'` by id and
includes them in the active set; slot subflows then inject the body
+ tools.

The tool's description lists each Skill's `id` + `description` so
the LLM can choose meaningfully without first calling `list_skills`
(a perf trade-off — small registries can afford the inline catalog;
large ones should use `list_skills` for discovery and rely on the
shorter `read_skill` description.) See `surfaceMode` (Block A4) for
tunable trade-offs.

Returns `undefined` when there are no skills — callers should
guard or filter undefined out of their tool list.

## Parameters

### skills

readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

## Returns

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`
