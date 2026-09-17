---
title: LedgerFactPin
---

# Interface: LedgerFactPin

Defined in: src/core/agent/window/ledgerFactPins.ts:81

One turn the pin holds, and what holding it costs.

## Properties

### chars

> `readonly` **chars**: `number`

Defined in: src/core/agent/window/ledgerFactPins.ts:104

Content characters of the WHOLE turn — the assistant's call and its
results leave together, so the turn is what the pin actually holds.

***

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: src/core/agent/window/ledgerFactPins.ts:99

Index of the turn's first message in the window.

***

### toolCallIds

> `readonly` **toolCallIds**: readonly `string`[]

Defined in: src/core/agent/window/ledgerFactPins.ts:88

Every tool result the turn holds, in wire order — not only the facts.
The turn is what the pin actually holds: a noise result answered in the
same batch as a fact stays with it, and each result's own standing is on
the ledger by this id.

***

### toolName

> `readonly` **toolName**: `string`

Defined in: src/core/agent/window/ledgerFactPins.ts:95

The tool of the newest nameable result in the turn — the name the record
files under `WindowObservations.pinned`. A turn is usually one tool; a
batch is named for its newest member, the same way the sibling pin names
a turn for the latest result it holds.

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: src/core/agent/window/ledgerFactPins.ts:97

Index of the turn in this iteration's segmentation.
