---
title: BrowserSession
---

# Interface: BrowserSession

Defined in: [src/adapters/types.ts:936](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L936)

One open browser session.

## Properties

### automationEndpoint?

> `readonly` `optional` **automationEndpoint?**: `string`

Defined in: [src/adapters/types.ts:946](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L946)

Where an automation client attaches — a CDP WebSocket, for Playwright and
friends. Absent on a backend that offers no such channel.

This library does not drive the page for you and does not depend on
Playwright; it hands you the endpoint and stays out of the way.

***

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:938](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L938)

The backend's own id for this session.

***

### liveViewEndpoint?

> `readonly` `optional` **liveViewEndpoint?**: `string`

Defined in: [src/adapters/types.ts:948](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L948)

Where a PERSON can watch this session, when the backend offers a view.

## Methods

### click()

> **click**(`req`): `Promise`\<`void`\>

Defined in: [src/adapters/types.ts:950](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L950)

Click at a point, in the operating system rather than in the page.

#### Parameters

##### req

###### button?

`"left"` \| `"middle"` \| `"right"`

###### clicks?

`number`

###### x

`number`

###### y

`number`

#### Returns

`Promise`\<`void`\>

***

### handControlTo()?

> `optional` **handControlTo**(`driver`): `Promise`\<`void`\>

Defined in: [src/adapters/types.ts:970](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L970)

Hand the controls to a person, or take them back (optional).

This is the seam a human-in-the-loop browsing flow is built on: the agent
stops driving, a person finishes the step that needed them — a login, a
consent screen, a CAPTCHA — and the agent resumes on the page they left.
Absent on a backend with no such notion; feature-detect before offering it.

#### Parameters

##### driver

[`BrowserDriver`](/docs/api/type-aliases/BrowserDriver)

#### Returns

`Promise`\<`void`\>

***

### press()

> **press**(`req`): `Promise`\<`void`\>

Defined in: [src/adapters/types.ts:959](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L959)

Press a named key, optionally more than once.

#### Parameters

##### req

###### key

`string`

###### times?

`number`

#### Returns

`Promise`\<`void`\>

***

### screenshot()

> **screenshot**(): `Promise`\<[`BrowserShot`](/docs/api/interfaces/BrowserShot)\>

Defined in: [src/adapters/types.ts:961](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L961)

Take a screenshot of the session as it is now.

#### Returns

`Promise`\<[`BrowserShot`](/docs/api/interfaces/BrowserShot)\>

***

### stop()

> **stop**(): `Promise`\<`void`\>

Defined in: [src/adapters/types.ts:978](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L978)

Release the session.

Must tolerate a session the far side already reaped — an idle timeout is
the reality on every managed backend, and a stop on a dead session is a
no-op, not an error.

#### Returns

`Promise`\<`void`\>

***

### type()

> **type**(`text`): `Promise`\<`void`\>

Defined in: [src/adapters/types.ts:957](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L957)

Type text, as a keyboard would.

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`void`\>
