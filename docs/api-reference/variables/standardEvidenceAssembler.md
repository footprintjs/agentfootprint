[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / standardEvidenceAssembler

# Variable: standardEvidenceAssembler

> `const` **standardEvidenceAssembler**: [`CheckInAssembler`](/agentfootprint/api/generated/type-aliases/CheckInAssembler.md)

Defined in: [src/core/checkin.ts:423](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/checkin.ts#L423)

The `'standard'` assembler — fills all four evidence fields. The `drivers`
ranking runs the configured scorer over the run-so-far context units; the
default scorer is deterministic and makes zero LLM/network calls.
