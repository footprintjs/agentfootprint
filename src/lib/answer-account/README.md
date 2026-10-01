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

const account = accountForAnswer(
  recording,
  {
    skills: { 'array-inventory': { label: 'array estate report' } },
    tools: { powerstore_get_volumes: { rowsAt: 'volumes' } }, // where a wrapper result keeps its rows
    routing: { appDecides: true },
  },
  { runId: storedArtifact.meta.origin.runId },
);

account.summary.sentence.text;
// "An empty result that did not declare what it searched, from powerstore_get_volumes
//  in an earlier answer (at least 1 answer back), was in front of the model when it answered."
account.summary.sentence.source; // 'app' — only the app's `rowsAt` made that result "empty"
```

That is fixture A — the real `recording-turn2.json` — and its whole account is
pinned in `test/lib/answer-account/golden/turn2.A.txt`:

| row            | a line it prints                                                              | voucher                       |
| -------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| You asked      | “what applications are running on powerstore SHPSTRPLPCL003”                  | person                        |
| It understood  | The library's routing picked the array estate report skill (array-inventory). | library (the label part: app) |
|                | The app's scoring put it first: 1 against 0 for every other skill.            | app                           |
| It checked     | get_array_inventory says it checked: • …                                      | tool:get_array_inventory      |
| It found       | get_array_inventory looked for a VM disk … and found none.                    | tool:get_array_inventory      |
| How sure       | Not sure — the record holds 2 reasons this answer may not stand: • 1 call declared ground it did not check or can never cover. • 1 call declared that nothing matched. | library |
| Anything wrong | 1 of the 3 checks could not be run on this record.                            | library                       |

The "How sure" row opens with the answer's STANDING — the one fold,
`core/agent/assessment/assess.ts` · `assessAnswer`, over the recording's
committed state (never its events): known · consistent with the record · not
sure (each reason a line, counting CALLS — one `coverage(absent(…))` files two
rows and is one call) · ask · not assessed. Two cases are settled before the
fold, and they are the only ones the row settles itself:

- the run PAUSED (any kind — a typed input, `askHuman`, a check-in, a middleware
  ask): the fold reads it from the committed state the pause leaves
  (`pausedToolCallId`), so the row says "Ask — …", the word
  `agent.assessment()` says;
- the record shows NO answer and no pause (no `turn_end`: the run threw, a rule
  stopped it before it answered, or the recording ends early): the row says
  "How sure cannot be told: this record does not show the run giving an
  answer." — no standing is folded for an answer that does not exist
  (`agent.assessment()` resolves to `undefined` there).

Fixture A was reduced before the fold existed: its state keeps `history` but not
`coverageDeclared`. The fold never rebuilds that row from the events, but the
absence envelope the model read is still in the committed `history`, and a call
with no row is read off its bytes — so the reduced record reads what the full
one does (`test/core/agent/assessment/fold-real-record.test.ts` pins both).
Every result — here and in the standing — is read by the ONE emptiness reader,
`core/agent/coverage/emptiness.ts` · `readEmptiness`. They differ in one place,
named: for this run's calls "It found" holds the door the EVENTS are, so an
envelope a tool returned as JSON text that the run never recognized is "returned
a result" there, while the standing — which holds a door only where a committed
coverage row is — reads the envelope (it may over-report; it never hides).

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
   **A resumed leg reads the part before the pause from what its record
   carries** (`facts/pausedLeg.ts` · `readPausedLeg`): the recording holds that
   leg's events only, but also the state the run PAUSED with
   (`snapshot.initialState`) and the committed state after it — so each call
   answered before the pause is listed with what came back (its message in
   `history`, by the one emptiness reader) and what its tool declared (its
   `coverageDeclared` rows), and the checks judge them like this leg's calls.
   The ROUTING verdict is read the same way (`facts/understood.ts` ·
   `routingVerdictOf`, the one reader): RouteTurn commits `turnRoute` and the
   scorer's `entryScores` before the loop, so "It understood" names it from
   the paused state, with the "before the pause — read from the state" chip,
   and check 1 runs. What is NOT recoverable is said, and only that: that
   part's other events — what was in front of the model then, whether a call
   then failed or was refused (`wrong.beforePause.held.events`,
   `summary.resumed.held`). "The routing happened before the pause and is not
   in this record" is printed only when the state holds no verdict either, and
   "what happened before the pause is not in this record" only when the record
   holds no paused state (an older or trimmed recording).

   ```ts
   // a resumed `.time()` leg: the person confirmed "6:25 to 6:45 AM" (test/lib/answer-account/paused-leg.test.ts)
   account.rows.find((r) => r.id === 'found')!.lines.map((l) => l.text);
   // ['pscale_client_health returned …', 'Before the pause, cluster_lookup returned 1 item.']
   account.summary.sentence.text;
   // '… This answer continued after a pause; this record holds the state the run kept
   //  from before it, not that part's events.'
   ```
3. **Templates output typed text parts, never HTML** (`text` / `code` / `quote` /
   `label`), filled non-recursively: a value is never re-read as a template.
4. **Own run only.** Events are kept by `bridge/eventMeta.ts` · `eventBelongsToRun`,
   keyed on the agentfootprint run id — `options.runId` (the stored artifact's
   `meta.origin.runId`), else the recording's `run_configured`, else the
   `turn_end` owner; never `snapshot.runId` (another id space). With no id at all
   the account reads everything and says so (`scope.unfiltered@1`).
   The account names the run by its run id and never carries the conversation
   (session) id: in an `open` door that id is the conversation's only key, and
   an account is what people share.
5. **"In front of the model" is proven by the witness**, not by end-of-run
   state: the `context.injected` tool-result rows of the answering iteration's
   messages compose (`facts/inView.ts` · `witnessesOf`), and only EARLIER
   answers' results — distance ≥ 1, never a call of this run.
6. **Signals, not causes.** Three checks (decided-delivered, existence,
   empty-results); a check that could not run is listed as unreachable, and one
   that does not apply is left out of the count. A call the record shows
   PRESENTING an artifact (`artifacts.presented`) returned a receipt for the
   screen, not data: the empty-results check does not ask it.
7. **Judge everything; cap only what is listed.** The checks, the error and
   withheld counts read EVERY call and EVERY declared item
   (`facts/calls.ts` · `CallsRead.all`); the caps below bound only what is
   printed or listed, and every fold says "…and N more". A call no event names
   is counted as unread and kept — said to be unnamed, never dropped. A
   permission verdict refuses a call only when it is `deny` or `halt`
   (`gate_open` lets it run). A run id that owns no event of the record gets an
   account that says so, and claims nothing about that run.
8. **Bounded by construction** — ≤ 50 calls in the facts, 5 per row, a shared
   item budget and a shared long-text budget (`facts/common.ts` · `ITEM_BUDGET`,
   `LONG_TEXT_BUDGET`), at most 12 pointers per sentence, model-chosen ids and
   names cut at 200 characters in the facts (refusals ≤ 12, in-view ≤ 50),
   every string var ≤ 2,000 characters: the account stays ≤ 128 KB, the op's
   response ≤ 192 KB.
9. **Show me = allow-listed leaves** (`shown.ts` · `SHOW_ME_ALLOW_LIST`); the
   deny list (injection bodies, tool args and results, a decision's `why`,
   `resumeInput`, the live heap, history content) wins. An emptiness leaf is a
   derived `{ rows, at }`, never the rows. Past 64 KB no pointer adds a key;
   one `#more` entry says the rest is withheld.
10. **A tool's own words are printed as the tool wrote them** — `lookedFor`,
    `what`, `short`. An author who interpolates the caller's arguments into
    them puts those arguments in the report too (the af-1 "never interpolate"
    rule, `core/agent/coverage/README.md`); the report is scoped to its owner.

## Files

| file                         | job                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                   | the `AnswerAccount` shape (one exported name; the family by indexed access)                                                                 |
| `view.ts`                    | `recordingView` — ONE indexed pass, filtered to this run                                                                                    |
| `facts/`                     | one reader per row: `asked`, `understood`, `calls` (+ `checked`), `found` (+ `inView`), `howSure`; `pausedLeg` — the part before a pause, from the state the record holds |
| `signals.ts`                 | the three checks, the signals, "Anything wrong", the one-liner                                                                              |
| `templates.ts` / `render.ts` | the closed table and its filler (grammar: `count` pairs, `allOf`, `joinAnd`, `distance`)                                                    |
| `account.ts`                 | `accountForAnswer`; the per-sentence catch (`unreadable.line@1`)                                                                            |
| `shown.ts`                   | `showLeaves` + the allow-list — the hosting op's half (af-3), not a door                                                                    |
| `pointerKey.ts`              | `answerAccountPointerKey` — the ONE key format of the `shown` map; a leaf, public so the lens looks pointers up by the key the server wrote |
| `declarations.ts`            | the app's declared data, validated (a caller error throws)                                                                                  |

## Changing the words

Change a template's text → bump its `version` AND
`ANSWER_ACCOUNT_TEMPLATE_SET_VERSION`, then regenerate the goldens
(`AF_ANSWER_ACCOUNT_GOLDEN=update npx vitest run test/lib/answer-account`). The
pinned digest fails a word change without a bump. English-only surfaces for the
later locale map: the table itself, `joinAnd`'s ", " / " and ".
