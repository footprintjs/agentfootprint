---
title: SourceEvidenceLimits
---

# Interface: SourceEvidenceLimits

Defined in: [src/artifacts/sourceEvidence/types.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L57)

Bound every native write, scan and response. These limits never enlarge store retention.

## Properties

### maxReceiptBytes?

> `readonly` `optional` **maxReceiptBytes?**: `number`

Defined in: [src/artifacts/sourceEvidence/types.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L59)

***

### maxReceipts?

> `readonly` `optional` **maxReceipts?**: `number`

Defined in: [src/artifacts/sourceEvidence/types.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L58)

***

### maxResponseBytes?

> `readonly` `optional` **maxResponseBytes?**: `number`

Defined in: [src/artifacts/sourceEvidence/types.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L61)

***

### maxScanned?

> `readonly` `optional` **maxScanned?**: `number`

Defined in: [src/artifacts/sourceEvidence/types.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L60)

***

### timeoutMs?

> `readonly` `optional` **timeoutMs?**: `number`

Defined in: [src/artifacts/sourceEvidence/types.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L63)

Maximum wait for one retention/discovery/read operation, including host callbacks.
