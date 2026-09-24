---
title: LedgerFactPin
---

# Interface: LedgerFactPin

Defined in: [src/core/agent/window/ledgerFactPins.ts:82](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/ledgerFactPins.ts#L82)

One turn the pin holds, and what holding it costs.

## Properties

### chars

> `readonly` **chars**: `number`

Defined in: [src/core/agent/window/ledgerFactPins.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/ledgerFactPins.ts#L106)

Content characters of the WHOLE turn — the assistant's call and its
results leave together, so the turn is what the pin actually holds.

***

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: [src/core/agent/window/ledgerFactPins.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/ledgerFactPins.ts#L101)

Index of the turn's first message in the window.

***

### toolCallIds

> `readonly` **toolCallIds**: readonly `string`[]

Defined in: [src/core/agent/window/ledgerFactPins.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/ledgerFactPins.ts#L90)

Every tool result the turn holds, in wire order — not only the facts.
The turn is what the pin actually holds: a noise result answered in the
same batch as a fact stays with it, and each result's own standing is on
the ledger by this id. A message the batch settlement wrote (9.113.0) is
no result and is never listed (`findings/offer.ts` · `isResultMessage`).

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/window/ledgerFactPins.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/ledgerFactPins.ts#L97)

The tool of the newest nameable result in the turn — the name the record
files under `WindowObservations.pinned`. A turn is usually one tool; a
batch is named for its newest member, the same way the sibling pin names
a turn for the latest result it holds.

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: [src/core/agent/window/ledgerFactPins.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/ledgerFactPins.ts#L99)

Index of the turn in this iteration's segmentation.
