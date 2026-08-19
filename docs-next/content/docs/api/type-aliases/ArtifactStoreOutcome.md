---
title: ArtifactStoreOutcome
---

# Type Alias: ArtifactStoreOutcome

> **ArtifactStoreOutcome** = `object` & \{ `status`: `"passed"`; \} \| \{ `missing`: [`ArtifactStoreMember`](/docs/api/type-aliases/ArtifactStoreMember); `status`: `"not-applicable"`; \} \| \{ `reason`: `string`; `status`: `"declared"`; `stillFails`: `boolean`; \} \| \{ `error`: `Error`; `status`: `"failed"`; \}

Defined in: [src/artifacts/conformance/types.ts:195](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L195)

How one case came out.

 - `'passed'` — the store holds the law.
 - `'not-applicable'` — the case is about an OPTIONAL member this store does
   not implement. Feature detection, not a gap.
 - `'declared'` — the store implements the member and cannot satisfy the
   case, and said so by name. `stillFails: false` means the declaration is
   stale: it passes now.
 - `'failed'` — including "needed a harness hook nobody provided and nobody
   declared", because an undeclared skip is exactly what this battery
   refuses to let look like a pass.

## Type Declaration

### case

> `readonly` **case**: [`ArtifactStoreCaseName`](/docs/api/type-aliases/ArtifactStoreCaseName)

### law

> `readonly` **law**: `string`
