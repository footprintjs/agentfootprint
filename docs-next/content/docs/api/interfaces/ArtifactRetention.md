---
title: ArtifactRetention
---

# Interface: ArtifactRetention

Defined in: [src/artifacts/retention.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/retention.ts#L37)

The three dials. All optional; absent means that dial does not bind.

## Properties

### maxBytesPerScope?

> `readonly` `optional` **maxBytesPerScope?**: `number`

Defined in: [src/artifacts/retention.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/retention.ts#L41)

Byte budget per scope.

***

### maxCountPerScope?

> `readonly` `optional` **maxCountPerScope?**: `number`

Defined in: [src/artifacts/retention.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/retention.ts#L43)

Row budget per scope.

***

### ttlMs?

> `readonly` `optional` **ttlMs?**: `number`

Defined in: [src/artifacts/retention.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/retention.ts#L39)

Lifetime stamped onto every mint as `expiresAt` (unix ms after createdAt).
