---
title: IN_PROGRESS_WIRE
---

# Variable: IN\_PROGRESS\_WIRE

> `const` **IN\_PROGRESS\_WIRE**: `Readonly`\<\{ `count`: `"count"`; `key`: `"in_progress"`; \}\>

Defined in: [src/core/agent/coverage/inProgress.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/inProgress.ts#L51)

The wire spelling as DATA — the key an in-progress list sits under inside
`af_coverage`, and its one item key that is not the coverage items' own.
`canonical-notes.json` publishes it (`scripts/gen-canonical-notes.mjs`), so a
tool written in another language mints it byte for byte.
