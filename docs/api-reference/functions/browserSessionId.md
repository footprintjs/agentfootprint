[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / browserSessionId

# Function: browserSessionId()

> **browserSessionId**(`options?`): `string`

Defined in: [src/hosting/browserSession.ts:107](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/hosting/browserSession.ts#L107)

The conversation this browser is having with your agent: minted once, kept,
and handed back on every later call.

Pass it as `x-session-id` (or in the JSON body as `sessionId`) and a
`standingAgent` will hydrate the same conversation on every turn — and, since
9.10.0, scope the agent's memory to it too, with no configuration.

── What it is, and the thing it is NOT ──────────────────────────────────────
**A session id is not authentication.** It is a handle the browser carries,
and anyone who can reach your host can send any string in its place. Nothing
here signs it, and nothing on the server side checks it: authenticate the
caller by your own means, then check that the authenticated principal is
allowed the session they claimed. Storing anything sensitive under a session
id alone is storing it under a value the client controls.

── Where it is kept, and what that costs ────────────────────────────────────
`localStorage`, under [BrowserSessionIdOptions.storageKey](/agentfootprint/api/generated/interfaces/BrowserSessionIdOptions.md#storagekey). That means
it survives a reload and a closed tab, is scoped to the ORIGIN, and is
readable by any script running on that origin — including one you did not
write. It is per browser profile, so the same person on a phone and a laptop
is two conversations, and a shared machine is one.

When `localStorage` cannot be reached — private mode in some browsers throws
on access, and there is no `window` at all during SSR — the id is kept in a
module-level `Map` instead. Same id for the life of the page, gone on reload.
This is a fallback and it is stated rather than hidden: a page that must
survive a reload in private mode needs its own storage.

── How it is minted ─────────────────────────────────────────────────────────
`crypto.randomUUID()` where it exists (every current browser, in a secure
context), then `crypto.getRandomValues`. Both are unguessable. On a runtime
that has NEITHER — an insecure-context page in an older browser — it falls
back to `Math.random`, which is **not** unguessable, and that is survivable
only because of the paragraph above: this id is a handle, never a credential.

## Parameters

### options?

[`BrowserSessionIdOptions`](/agentfootprint/api/generated/interfaces/BrowserSessionIdOptions.md) = `{}`

## Returns

`string`

## Examples

**A chat page that remembers across reloads**

```ts
import { browserSessionId } from 'agentfootprint';

const sessionId = browserSessionId();
const reply = await fetch('/invoke', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-session-id': sessionId },
  body: JSON.stringify({ input: message }),
}).then((r) => r.json());
```

**Two agents on one origin, two conversations**

```ts
const support = browserSessionId({ storageKey: 'support.sessionId' });
const billing = browserSessionId({ storageKey: 'billing.sessionId' });
```
