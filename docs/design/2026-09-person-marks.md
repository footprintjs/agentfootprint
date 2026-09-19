# Person marks — the person's standing on a reply (HLD, not built)

**Status:** high-level design, 2026-09-18. Owner's ruling: build later; deep design at build time.

## The problem

A good reply can be lost to compaction (recency wins), and a reply the person already
rejected keeps riding along. The person knows which is which and has nowhere to say it.

## The idea, in one line

The person declares a standing on a **reply** — `good | noise | irrelevant` — the way the
model declares one on a **tool result** (`fact | open | noise | ruled-out`) and the judge
writes its own row beside it. Third voice, same ledger, kept apart by `source`.

| | model | judge (9.104.0) | person (this) |
|---|---|---|---|
| declares on | a tool result | a tool result | a reply (turn) |
| row | `standing`, no `source` | `standing`, `source: 'judge'` | `standing`, `source: 'person'`, `declaredOn: { turnId }` |
| words | fact / open / noise / ruled-out | the model's words | good / noise / irrelevant |

**Law:** a person's `good` never becomes the model's `fact`. It means *keep and prefer*, not
*true*. The evidence gate, the standings and the absence scorer do not read it.

## What it changes

1. **Compaction (window/):** a fourth named hold in the refusal engine, `'person-good'`, with
   a ceiling (`keepGood`, default small) — the same contract as `'ledger-fact'`, arriving
   through `planRemoval`; no strategy file changes. `noise` / `irrelevant` turns leave
   **first**, before any undeclared turn. The record files both (`WindowRecord.personMarks`).
2. **Served (opt-in):** `ask: 'person-marks' | 'none'` — one line, data only: *"the person
   marked turns 3, 7 good and 5 noise"*. Off by default until the bench says it helps.
3. **Record + events:** rows on `findingsLedger`; `agentfootprint.findings.person_mark`.
4. **Lens:** Findings band / Proof Map / Story chip draw `source: 'person'` as its own tone.
5. **App (host):** three buttons on a reply; the marks ride the next request like the quoted
   line; a mark on a turn the record does not hold is refused by name.

Zero cost when nothing is marked: the same objects as today (the `ledgerFactPins` precedent).

## What is measured before the served line stays

Multi-turn bench, marks on vs off: (a) the good turn survives compaction (mechanical, must be
1.0); (b) repeat-of-noise in later answers; (c) consistency with the good answer; (d) tokens.
Only (a) and "noise leaves first" are claimed before the run.

## Related reading (why a human mark beats a rated one)

Generative Agents (Park 2023: recency × importance × relevance, importance model-rated);
MemGPT (Packer 2023: explicit pin-to-context); Lost in the Middle (Liu 2023: position, not
weight); Mem0 / A-MEM (2024–25: feedback signals, no record of *why* a turn survived).

## Not in scope

Reordering the window by mark (position is the model's to read, the record's to keep);
training on marks; the person's mark on a tool result (that is the model's and the judge's).
