**Fold** — "Explain this answer": one answer's recording read back as fixed,
vouched sentences a person can follow.

`accountForAnswer(recording, declarations?, { runId? })` reads ONE answer's
recording and returns a typed **answer account**: the facts the record holds,
each with **who vouches for it** and **where it lives in the record**, and a
fixed set of sentences rendered from those facts by a closed, versioned template
table. It is a pure read-time Fold over the Trace — no clock, network, model or
randomness; the same inputs give the same bytes; it never writes into the run.

```ts
import { accountForAnswer } from 'agentfootprint/observe';

const account = accountForAnswer(recording, {
  skills: { 'array-inventory': { label: 'array estate report' } },
  tools: { powerstore_get_volumes: { rowsAt: 'volumes' } }, // where a wrapper result keeps its rows
  routing: { appDecides: true },
}, { runId: storedArtifact.meta.origin.runId });

account.summary.sentence.text;
// "An empty result that did not declare what it searched, from powerstore_get_volumes
//  in an earlier answer (at least 1 answer back), was in front of the model when it answered."
account.summary.sentence.source; // 'app' — only the app's `rowsAt` made that result "empty"
```

That is fixture A — the real `recording-turn2.json` — and its whole account is
pinned in `test/lib/answer-account/golden/turn2.A.txt`:

| row | a line it prints | voucher |
|---|---|---|
| You asked | “what applications are running on powerstore SHPSTRPLPCL003” | person |
| It understood | The library's routing picked the array estate report skill (array-inventory). | library (the label part: app) |
| | The app's scoring put it first: 1 against 0 for every other skill. | app |
| It checked | get_array_inventory says it checked: • … | tool:get_array_inventory |
| It found | get_array_inventory looked for a VM disk … and found none. | tool:get_array_inventory |
| How sure | The record does not rate how sure this answer is. | library (not recorded) |
| Anything wrong | 1 of the 3 checks could not be run on this record. | library |

## The laws

1. **Every sentence carries its template `id@version` and the voucher of its
   WEAKEST truth-deciding input** — `person` > `library` > `tool:<name>` >
   `model` > `app`. A declared label is presentation: it is its own part with
   its own voucher and never moves the sentence's (`render.ts` · `sentenceSource`).
2. **A missing fact says "not recorded" or "cannot be told" — never a guess.** A
   claim of ABSENCE needs proof: "the decided skill was not given" requires every
   system-prompt composition of the run to be recorded and complete
   (`facts/understood.ts` · `deliveryComplete`); otherwise the check is
   unreachable, never a signal.
3. **Templates output typed text parts, never HTML** (`text` / `code` / `quote` /
   `label`), filled non-recursively: a value is never re-read as a template.
4. **Own run only.** Events are kept by `bridge/eventMeta.ts` · `eventBelongsToRun`,
   keyed on the agentfootprint run id — `options.runId` (the stored artifact's
   `meta.origin.runId`), else the recording's `run_configured`, else the
   `turn_end` owner; never `snapshot.runId` (another id space). With no id at all
   the account reads everything and says so (`scope.unfiltered@1`).
5. **"In front of the model" is proven by the witness**, not by end-of-run
   state: the `context.injected` tool-result rows of the answering iteration's
   messages compose (`facts/inView.ts` · `witnessesOf`), and only EARLIER
   answers' results — distance ≥ 1, never a call of this run.
6. **Signals, not causes.** Three checks (decided-delivered, existence,
   empty-results); a check that could not run is listed as unreachable, and one
   that does not apply is left out of the count.
7. **Bounded by construction** — ≤ 50 calls in the facts, 5 per row, a shared
   item budget and a shared long-text budget (`facts/common.ts` · `ITEM_BUDGET`,
   `LONG_TEXT_BUDGET`), every string var ≤ 2,000 characters: the account stays
   ≤ 128 KB, the op's response ≤ 192 KB.
8. **Show me = allow-listed leaves** (`shown.ts` · `SHOW_ME_ALLOW_LIST`); the
   deny list (injection bodies, tool args and results, a decision's `why`,
   `resumeInput`, the live heap, history content) wins. An emptiness leaf is a
   derived `{ rows, at }`, never the rows.

## Files

| file | job |
|---|---|
| `types.ts` | the `AnswerAccount` shape (one exported name; the family by indexed access) |
| `view.ts` | `recordingView` — ONE indexed pass, filtered to this run |
| `facts/` | one reader per row: `asked`, `understood`, `calls` (+ `checked`), `found` (+ `inView`), `howSure` |
| `signals.ts` | the three checks, the signals, "Anything wrong", the one-liner |
| `templates.ts` / `render.ts` | the closed table and its filler (grammar: `count` pairs, `allOf`, `joinAnd`, `distance`) |
| `account.ts` | `accountForAnswer`; the per-sentence catch (`unreadable.line@1`) |
| `shown.ts` | `showLeaves` + the allow-list — the hosting op's half (af-3), not a door |
| `declarations.ts` | the app's declared data, validated (a caller error throws) |

## Changing the words

Change a template's text → bump its `version` AND
`ANSWER_ACCOUNT_TEMPLATE_SET_VERSION`, then regenerate the goldens
(`AF_ANSWER_ACCOUNT_GOLDEN=update npx vitest run test/lib/answer-account`). The
pinned digest fails a word change without a bump. English-only surfaces for the
later locale map: the table itself, `joinAnd`'s ", " / " and ".
