[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / standardEvidenceAssembler

# Variable: standardEvidenceAssembler

> `const` **standardEvidenceAssembler**: [`CheckInAssembler`](/agentfootprint/api/generated/type-aliases/CheckInAssembler.md)

Defined in: [src/core/checkin.ts:423](https://github.com/footprintjs/agentfootprint/blob/a056409d5d117d220bc61985a6eed33349eeca8f/src/core/checkin.ts#L423)

The `'standard'` assembler — fills all four evidence fields. The `drivers`
ranking runs the configured scorer over the run-so-far context units; the
default scorer is deterministic and makes zero LLM/network calls.
