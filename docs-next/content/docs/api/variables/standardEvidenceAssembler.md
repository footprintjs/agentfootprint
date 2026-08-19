---
title: standardEvidenceAssembler
---

# Variable: standardEvidenceAssembler

> `const` **standardEvidenceAssembler**: [`CheckInAssembler`](/docs/api/type-aliases/CheckInAssembler)

Defined in: [src/core/checkin.ts:506](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L506)

The `'standard'` assembler — fills all four evidence fields. The `drivers`
ranking runs the configured scorer over the run-so-far context units; the
default scorer is deterministic and makes zero LLM/network calls.
