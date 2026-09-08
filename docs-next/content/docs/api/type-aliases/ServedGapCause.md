---
title: ServedGapCause
---

# Type Alias: ServedGapCause

> **ServedGapCause** = `"no-receipt-committed"` \| `"receipt-shape-rejected"`

Defined in: src/lib/time-travel/servedView.ts:217

WHAT STOOD IN THE WAY, as far as the record shows — computed at the read that
failed, so it is a value and not a sentence.

It exists because the alternative was tried and it went false. A gap's `why`
listed the causes somebody could think of; a cause nobody had thought of was
added; the sentence was wrong and nobody had edited it. A frozen constant
cannot know what happened at the site it is printed beside. The site can.

The set is closed AT THE SITE, which is narrower than everything that can go
wrong upstream and is meant to be. A recording made before the receipt
existed, a chart whose LLM stage mints none, and a run that declined with
`recordReceipt: false` all leave the SAME record — no value under the receipt
key — so they all land on `'no-receipt-committed'`. Claiming to tell them
apart there would be this field repeating the defect it was added to fix.

- `'no-receipt-committed'` — nothing was committed under the receipt key on
  this epoch's call.
- `'receipt-shape-rejected'` — something WAS committed there and the read
  refused it, because it carries no basis and a value without one is not a
  receipt. This is the value that means DAMAGE: a recording that lost or
  rewrote part of its own log. The other means the run simply never minted.
