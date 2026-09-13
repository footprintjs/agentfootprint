---
title: ToolArtifactPutInput
---

# Type Alias: ToolArtifactPutInput

> **ToolArtifactPutInput** = `Omit`\<[`PutArtifactInput`](/docs/api/interfaces/PutArtifactInput), `"origin"`\>

Defined in: src/artifacts/capability.ts:40

A tool's `put` — everything the caller owns EXCEPT `origin`, which the
 framework stamps from the run's own facts (never invented, never spoofed).
