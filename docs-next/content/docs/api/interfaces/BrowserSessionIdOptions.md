---
title: BrowserSessionIdOptions
---

# Interface: BrowserSessionIdOptions

Defined in: src/hosting/browserSession.ts:33

Options for [browserSessionId](/docs/api/functions/browserSessionId).

## Properties

### storageKey?

> `readonly` `optional` **storageKey?**: `string`

Defined in: src/hosting/browserSession.ts:40

Where the id is kept. Default `'agentfootprint.sessionId'`.

Change it when one origin serves two different agents that must not share a
conversation — two keys, two sessions, one browser.
