[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BrowserSessionIdOptions

# Interface: BrowserSessionIdOptions

Defined in: [src/hosting/browserSession.ts:33](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/hosting/browserSession.ts#L33)

Options for [browserSessionId](/agentfootprint/api/generated/functions/browserSessionId.md).

## Properties

### storageKey?

> `readonly` `optional` **storageKey?**: `string`

Defined in: [src/hosting/browserSession.ts:40](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/hosting/browserSession.ts#L40)

Where the id is kept. Default `'agentfootprint.sessionId'`.

Change it when one origin serves two different agents that must not share a
conversation — two keys, two sessions, one browser.
