[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineInjectionOptions

# Type Alias: DefineInjectionOptions

> **DefineInjectionOptions** = `object` & [`DefineInstructionOptions`](/agentfootprint/api/generated/interfaces/DefineInstructionOptions.md) \| `object` & [`DefineSkillOptions`](/agentfootprint/api/generated/interfaces/DefineSkillOptions.md) \| `object` & [`DefineSteeringOptions`](/agentfootprint/api/generated/interfaces/DefineSteeringOptions.md) \| `object` & [`DefineFactOptions`](/agentfootprint/api/generated/interfaces/DefineFactOptions.md)

Defined in: [src/lib/injection-engine/factories/defineInjection.ts:32](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineInjection.ts#L32)

Discriminated union — `type` picks the flavor; the rest are that flavor's options.
