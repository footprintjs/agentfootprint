[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MessageDeniedContext

# Interface: MessageDeniedContext

Defined in: [src/core/agent/middleware/errors.ts:38](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/core/agent/middleware/errors.ts#L38)

MessageDeniedError — typed error thrown by `Agent.run()` when a
`messageMiddleware` returns `deny(reason)`.

Pattern: Typed Error (the `PolicyHaltError` shape, for the same reason).
Role:    Surface layer for the message boundary. The stage writes the
         refusal to scope; `Agent.finalizeResult` translates it here, so
         a caller can `instanceof` it and route on `.phase` / `.middleware`.
Emits:   N/A — `agentfootprint.middleware.decision` fires from the stage
         at the moment the refusal is decided.

## Why a refusal is not returned as an answer

At the `'input'` phase there is no model to tell: the message never
reached one, so there is nothing in the run for a denial to become. At
the `'output'` phase there IS an answer, and the middleware has just
refused to release it — handing the caller a string in its place is the
one substitution a caller must never be able to make silently. Both
phases therefore raise, exactly the way a policy halt does.

## What it deliberately does not carry

Never the refused content. A middleware that suppressed an answer would
be undone by an error object that carried the answer out anyway. The
content stays where the run put it — in the commit log, under whatever
redaction the run configured.

## Example

```ts
try {
    await agent.run({ message: userText });
  } catch (e) {
    if (e instanceof MessageDeniedError) {
      console.log(`${e.middleware} refused this ${e.phase}: ${e.reason}`);
    } else throw e;
  }
```

## Properties

### middleware

> `readonly` **middleware**: `string`

Defined in: [src/core/agent/middleware/errors.ts:44](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/core/agent/middleware/errors.ts#L44)

`name` of the middleware that returned `deny`.

***

### phase

> `readonly` **phase**: `"input"` \| `"output"`

Defined in: [src/core/agent/middleware/errors.ts:42](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/core/agent/middleware/errors.ts#L42)

Which boundary refused.

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/agent/middleware/errors.ts:40](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/core/agent/middleware/errors.ts#L40)

The refusal text the middleware returned.
