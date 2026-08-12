[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MiddlewareAsk

# Interface: MiddlewareAsk

Defined in: [src/core/pause.ts:61](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/pause.ts#L61)

The question a `toolMiddleware` put to a person, as it rides the checkpoint.

## Properties

### detail?

> `readonly` `optional` **detail?**: `unknown`

Defined in: [src/core/pause.ts:65](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/pause.ts#L65)

Anything else the answering UI should render. Never interpreted here.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: [src/core/pause.ts:67](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/pause.ts#L67)

`name` of the middleware that asked.

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/pause.ts:63](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/pause.ts#L63)

The question, in the middleware author's own words.
