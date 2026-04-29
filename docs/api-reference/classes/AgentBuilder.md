[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentBuilder

# Class: AgentBuilder

Defined in: [agentfootprint/src/core/Agent.ts:974](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L974)

Fluent builder. `tool()` accepts any Tool<TArgs, TResult> and registers
it by its schema.name. Duplicate names throw at build time.

## Constructors

### Constructor

> **new AgentBuilder**(`opts`): `AgentBuilder`

Defined in: [agentfootprint/src/core/Agent.ts:989](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L989)

#### Parameters

##### opts

[`AgentOptions`](/agentfootprint/api/generated/interfaces/AgentOptions.md)

#### Returns

`AgentBuilder`

## Methods

### appName()

> **appName**(`name`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1024](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1024)

Set the agent's display name — substituted as `{{appName}}` in
commentary + thinking templates. Same place to brand a tenant
("Acme Bot"), distinguish multi-agent roles ("Triage" vs
"Reviewer"), or localize ("Asistente"). Default: `'Chatbot'`.

#### Parameters

##### name

`string`

#### Returns

`this`

***

### build()

> **build**(): [`Agent`](/agentfootprint/api/generated/classes/Agent.md)

Defined in: [agentfootprint/src/core/Agent.ts:1182](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1182)

#### Returns

[`Agent`](/agentfootprint/api/generated/classes/Agent.md)

***

### commentaryTemplates()

> **commentaryTemplates**(`templates`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1039](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1039)

Override agentfootprint's bundled commentary templates. Spread on
top of `defaultCommentaryTemplates`; missing keys fall back. Same
`Record<string, string>` shape with `{{vars}}` substitution as
the bundled defaults — see `defaultCommentaryTemplates` for the
full key list.

Use cases: i18n (`'agent.turn_start': 'El usuario...'`), brand
voice ("You: {{userPrompt}}"), per-tenant customization.

#### Parameters

##### templates

`Readonly`\<`Record`\<`string`, `string`\>\>

#### Returns

`this`

***

### fact()

> **fact**(`injection`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1123](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1123)

Register a Fact — developer-supplied data the LLM should see.
User profile, env info, computed summary, current time, …
Distinct from Skills (LLM-activated guidance) and Steering
(always-on rules) in INTENT — the engine treats them all alike.

#### Parameters

##### injection

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)

#### Returns

`this`

***

### injection()

> **injection**(`injection`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1067](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1067)

Register any `Injection`. Use this for power-user / custom flavors;
for built-in flavors use the typed sugar (`.skill`, `.steering`,
`.instruction`, `.fact`).

#### Parameters

##### injection

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)

#### Returns

`this`

***

### instruction()

> **instruction**(`injection`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1113](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1113)

Register an Instruction — rule-based system-prompt guidance.
Predicate runs each iteration. Use for context-dependent rules
including the "Dynamic ReAct" `on-tool-return` pattern.

#### Parameters

##### injection

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)

#### Returns

`this`

***

### memory()

> **memory**(`definition`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1150](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1150)

Register a Memory subsystem — load/persist conversation context,
facts, narrative beats, or causal snapshots across runs.

The `MemoryDefinition` is produced by `defineMemory({ type, strategy,
store })`. Multiple memories layer cleanly via per-id scope keys
(`memoryInjection_${id}`):

```ts
Agent.create({ provider })
  .memory(defineMemory({ id: 'short', type: MEMORY_TYPES.EPISODIC,
                         strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
                         store }))
  .memory(defineMemory({ id: 'facts', type: MEMORY_TYPES.SEMANTIC,
                         strategy: { kind: MEMORY_STRATEGIES.EXTRACT,
                                     extractor: 'pattern' }, store }))
  .build();
```

The READ subflow runs at the configured `timing` (default
`MEMORY_TIMING.TURN_START`) and writes its formatted output to the
`memoryInjection_${id}` scope key for the slot subflows to consume.

#### Parameters

##### definition

[`MemoryDefinition`](/agentfootprint/api/generated/interfaces/MemoryDefinition.md)

#### Returns

`this`

***

### rag()

> **rag**(`definition`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1178](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1178)

Register a RAG retriever — semantic search over a vector-indexed
corpus. Identical plumbing to `.memory()` (RAG resolves to a
`MemoryDefinition` produced by `defineRAG()`); this alias exists
so the consumer's intent reads clearly:

```ts
agent
  .memory(shortTermConversation)   // remembers what the USER said
  .rag(productDocs)                // retrieves what the CORPUS says
  .build();
```

Both end up as memory subflows, but the alias separates "user
conversation memory" from "document corpus retrieval" in code
intent, ids, and Lens chips.

#### Parameters

##### definition

[`MemoryDefinition`](/agentfootprint/api/generated/interfaces/MemoryDefinition.md)

#### Returns

`this`

***

### skill()

> **skill**(`injection`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1080](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1080)

Register a Skill — LLM-activated, system-prompt + tools.
Auto-attaches the `read_skill` activation tool to the agent.
Skill stays active for the rest of the turn once activated.

#### Parameters

##### injection

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)

#### Returns

`this`

***

### skills()

> **skills**(`registry`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1095](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1095)

Bulk-register every Skill in a `SkillRegistry`. Use for shared
skill catalogs across multiple Agents — register skills once on
the registry; attach the same registry to every consumer Agent.

#### Parameters

##### registry

###### list

#### Returns

`this`

#### Example

```ts
const registry = new SkillRegistry();
  registry.register(billingSkill).register(refundSkill);
  const supportAgent = Agent.create({ provider }).skills(registry).build();
  const escalationAgent = Agent.create({ provider }).skills(registry).build();
```

***

### steering()

> **steering**(`injection`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1104](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1104)

Register a Steering doc — always-on system-prompt rule.
Use for invariant guidance: output format, persona, safety policies.

#### Parameters

##### injection

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)

#### Returns

`this`

***

### system()

> **system**(`prompt`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:993](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L993)

#### Parameters

##### prompt

`string`

#### Returns

`this`

***

### thinkingTemplates()

> **thinkingTemplates**(`templates`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1051](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1051)

Override agentfootprint's bundled thinking templates. Same
contract shape as commentary; different vocabulary — first-person
status the chat bubble shows mid-call. Per-tool overrides go via
`tool.<toolName>` keys (e.g., `'tool.weather': 'Looking up the
weather…'`). See `defaultThinkingTemplates` for the full key list.

#### Parameters

##### templates

`Readonly`\<`Record`\<`string`, `string`\>\>

#### Returns

`this`

***

### tool()

> **tool**\<`TArgs`, `TResult`\>(`tool`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:998](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L998)

#### Type Parameters

##### TArgs

`TArgs`

##### TResult

`TResult`

#### Parameters

##### tool

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`TArgs`, `TResult`\>

#### Returns

`this`

***

### tools()

> **tools**(`tools`): `this`

Defined in: [agentfootprint/src/core/Agent.ts:1013](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L1013)

Register many tools at once. Convenience for tool sources that
return a list (e.g., `await mcpClient(...).tools()`). Each tool
is registered via `.tool()` so duplicate-name validation still
fires per-entry.

#### Parameters

##### tools

readonly [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

#### Returns

`this`
