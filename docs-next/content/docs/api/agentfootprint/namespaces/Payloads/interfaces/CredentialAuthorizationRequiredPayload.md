---
title: CredentialAuthorizationRequiredPayload
---

# Interface: CredentialAuthorizationRequiredPayload

Defined in: [src/events/payloads.ts:519](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L519)

3-legged consent is required (the tool is not run until the user authorizes).
 Carries `sessionId` for correlation, NOT the authorization URL.

## Properties

### service

> `readonly` **service**: `string`

Defined in: [src/events/payloads.ts:520](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L520)

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: [src/events/payloads.ts:521](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L521)
