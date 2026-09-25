[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactRetention

# Interface: ArtifactRetention

Defined in: [src/artifacts/retention.ts:32](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/retention.ts#L32)

The three dials. All optional; absent means that dial does not bind.

## Properties

### maxBytesPerScope?

> `readonly` `optional` **maxBytesPerScope?**: `number`

Defined in: [src/artifacts/retention.ts:36](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/retention.ts#L36)

Byte budget per scope.

***

### maxCountPerScope?

> `readonly` `optional` **maxCountPerScope?**: `number`

Defined in: [src/artifacts/retention.ts:38](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/retention.ts#L38)

Row budget per scope.

***

### ttlMs?

> `readonly` `optional` **ttlMs?**: `number`

Defined in: [src/artifacts/retention.ts:34](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/retention.ts#L34)

Lifetime stamped onto every mint as `expiresAt` (unix ms after createdAt).
