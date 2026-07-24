---
title: standardEvidenceAssembler
---

# Variable: standardEvidenceAssembler

> `const` **standardEvidenceAssembler**: [`CheckInAssembler`](/docs/api/type-aliases/CheckInAssembler)

Defined in: [src/core/checkin.ts:423](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L423)

The `'standard'` assembler — fills all four evidence fields. The `drivers`
ranking runs the configured scorer over the run-so-far context units; the
default scorer is deterministic and makes zero LLM/network calls.
