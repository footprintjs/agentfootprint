## What it lets you measure

From the record alone, per model and per prompt or skill version: the **assumed-value rate**
(calls that ran on a default nobody chose — `default` rows over ruled-argument rows), the
**echoed-default rate** (the model sent the default itself — `default` rows that carry
`proposed`), the **model-chosen rate** (`model` rows), the **ask rate** (batches that asked —
`asked: 'missing'` rows, grouped by call and iteration), the **answered rate** (`answered`
over `asked` rows), the **kept-answer uses** (an `answered` row with no `asked` row for its
call and iteration: a call proposed again after the one-question law refused it, filled from
the kept answer — nobody was asked in that batch) and the **free-text share** (`free`), the **invalid-answer rate** and the
calls refused after three (`asked: 'invalid-answer'`), the share of answers whose standing
names an assumption (`argument-assumed`) or ended waiting on the library (`argument-asked`),
and — from the performance tests — what the layer costs per iteration in commit-log bytes and
what a 32-field ask costs to build. The **needless-ask rate** (the library asked for a value
the person had already given) is read from the same `asked` rows beside a case label: the
record says what was asked, the bench says whether the person had said it. These rows are
what a bench over the layer scores and what a lens draws — no second record is kept for
either. The limit: it measures whose value a call ran on, not whether that value was right.

Under declared sources, from the same rows: the **declared-source rate** (rows whose
`claimed` is not `none`), the **verified rate** — how often the model's quotes, ids and
earlier answers checked out, a COPYING measure, not an honesty measure (traced sources over
declared ones), the **failed-claim mix** (the `failed` values — `quote-not-found`,
`not-in-result`, `composed-message`, …), the **reading rate** (`said` + `reading`: values
read into the person's words), the **hint rate** (`coincides`; split it at
`integrity/argumentLeaves.ts` · `MIN_CHECKED_LENGTH`, four characters — a short value
coincides by chance), the **contingent uses** (`setAside`: values taken from a result the
model had set aside), the **composed-run exposure** (`failed: 'composed-message'`), the
**unverified-ask rate** (`asked: 'unverified'`) and — from the request receipts — the
**tokens per call** the `from` property costs
(`test/core/agent/arguments/sources-layer.test.ts` and `sources-served.test.ts` print the served
characters: on 2026-09-28, beside the ledger, the ruled tool's schema +744 characters, the system
prompt +0, an unruled tool +0 — the first cut was +617 and +447; without the ledger, the ruled
tool +863 over a plain agent's, where the ledger alone costs every tool about +2,400).
