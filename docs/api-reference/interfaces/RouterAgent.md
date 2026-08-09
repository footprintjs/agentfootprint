[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RouterAgent

# Interface: RouterAgent

Defined in: [src/patterns/LlmRouter.ts:108](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmRouter.ts#L108)

One line of the roster the router reads. `description` is what the LLM
sees — write it for the model ("Invoices, refunds and payment methods"),
not for your team's org chart.

The description is untrusted DATA: it is JSON-encoded into a single
roster line, and the router's rules are stated after the roster, so a
description cannot break out of its line or override the rules.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [src/patterns/LlmRouter.ts:112](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmRouter.ts#L112)

What this agent handles, in the model's language.

***

### id

> `readonly` **id**: `string`

Defined in: [src/patterns/LlmRouter.ts:110](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmRouter.ts#L110)

Stable id. The router must copy one of these verbatim to hand off.
