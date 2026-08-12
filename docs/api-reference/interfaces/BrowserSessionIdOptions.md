[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BrowserSessionIdOptions

# Interface: BrowserSessionIdOptions

Defined in: [src/hosting/browserSession.ts:33](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/hosting/browserSession.ts#L33)

Options for [browserSessionId](/agentfootprint/api/generated/functions/browserSessionId.md).

## Properties

### storageKey?

> `readonly` `optional` **storageKey?**: `string`

Defined in: [src/hosting/browserSession.ts:40](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/hosting/browserSession.ts#L40)

Where the id is kept. Default `'agentfootprint.sessionId'`.

Change it when one origin serves two different agents that must not share a
conversation — two keys, two sessions, one browser.
