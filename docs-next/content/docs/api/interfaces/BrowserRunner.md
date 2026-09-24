---
title: BrowserRunner
---

# Interface: BrowserRunner

Defined in: [src/adapters/types.ts:969](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L969)

A browser an agent can drive — the PORT (9.68.0).

Deliberately small, and deliberately not a browser automation API. Page-level
work (navigate, find an element, fill a form) is what CDP and Playwright
already do far better than any interface here would; a session exposes
[BrowserSession.automationEndpoint](/docs/api/interfaces/BrowserSession#automationendpoint) so those attach directly. What this
port carries is what an automation library CANNOT do on its own: open and
release a managed session, reach the operating system above the page, and —
the one that matters — hand the controls to a person and take them back.

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:971](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L971)

Stable id — reported on every tool-session event, so a row names its backend.

## Methods

### start()

> **start**(`req`): `Promise`\<[`BrowserSession`](/docs/api/interfaces/BrowserSession)\>

Defined in: [src/adapters/types.ts:978](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L978)

Open a session.

`key` is the ISOLATION key the caller derived. An adapter may use it to
name the remote session; it must never widen it.

#### Parameters

##### req

###### key

`string`

###### signal?

`AbortSignal`

#### Returns

`Promise`\<[`BrowserSession`](/docs/api/interfaces/BrowserSession)\>
