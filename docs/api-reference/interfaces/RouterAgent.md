[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RouterAgent

# Interface: RouterAgent

Defined in: [src/patterns/LlmRouter.ts:107](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/patterns/LlmRouter.ts#L107)

One line of the roster the router reads. `description` is what the LLM
sees — write it for the model ("Invoices, refunds and payment methods"),
not for your team's org chart.

The description is untrusted DATA: it is JSON-encoded into a single
roster line, and the router's rules are stated after the roster, so a
description cannot break out of its line or override the rules.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [src/patterns/LlmRouter.ts:111](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/patterns/LlmRouter.ts#L111)

What this agent handles, in the model's language.

***

### id

> `readonly` **id**: `string`

Defined in: [src/patterns/LlmRouter.ts:109](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/patterns/LlmRouter.ts#L109)

Stable id. The router must copy one of these verbatim to hand off.
