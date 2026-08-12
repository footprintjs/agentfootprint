[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / hashSessionKey

# Function: hashSessionKey()

> **hashSessionKey**(`key`): `string`

Defined in: [src/core/toolSessions.ts:217](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core/toolSessions.ts#L217)

A short, stable digest of an isolation key.

The key carries tenant, principal and the hosting `sessionId`. Publishing it
on the event wire would put a user identifier into every exporter's payload —
so the wire carries this instead, which is enough to JOIN two rows and not
enough to name whose they are. `meta.sessionId` already carries the session
legitimately (9.4.0); the payload does not repeat it.

SHA-256, first 12 hex chars, wherever `node:crypto` resolves. In a browser
bundle, where it does not, this falls back to the package's non-cryptographic
FNV-1a digest — stated here rather than implied, because a fallback nobody
documented is how "hashed" comes to mean less than a reader assumed.

## Parameters

### key

`string`

## Returns

`string`
