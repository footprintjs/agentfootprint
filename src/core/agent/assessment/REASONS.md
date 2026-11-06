# The reasons, and the row each is read from

`reasons.ts` · `REASONS` is the owner; this is its table for a reader. The narrative around it is
in [README.md](./README.md).

| Reason | Layer | Read from |
|---|---|---|
| `asked` | every | `pausedToolCallId`: the call a pause is still waiting on — a typed input (`requestInput`), a question (`askHuman` / `pauseHere`), a consent gate (a tool's `checkIn`, a middleware's `ask`) or a credential consent; never the pause event |
| `argument-asked` | 2 | `argumentAsk`: the inputs layer's batch ask with a question still out (`waiting`) — nothing in that batch has run; this turn's current `asked` rows on `findingsLedger` name the values; never the pause event |
| `argument-assumed` | 2 | `findingsLedger`: an `argument` row of this turn with `source: 'default'` — a tool's `askOrAssume` rule filled the value, or the model sent that same default; or `middlewareDecisions`: a before-tool rewrite of a ruled argument (`changedKeys`) with no declared origin (`allow(args, why, { from })`) |
| `argument-unverified` | 2 | `findingsLedger`: an `argument` row of this turn with `source: 'model'` on a ruled argument, or with a failed declared-source check (`failed`) on ANY argument — the model misstated the record |
| `argument-read` | 2 | `findingsLedger`: an `argument` row of this turn with `source: 'said'` and `reading` — the quoted words are the person's, the value is the model's reading of them (declared sources) |
| `value-contingent` | 2 | `findingsLedger`: an `argument` row of this turn with `source: 'result'` and `setAside` (the model named a result it had set aside); or a `contingent` row of this turn (stamped with it; unstamped on a call of this turn; unstamped on the answer on a first turn, or on a later turn when it follows — or is — a row the ledger shows to be this turn's: `assess.ts` · `firstRowOfTurn`) |
| `coverage-gap` | 3 | `coverageDeclared`: a `notChecked` or `cannotCover` item on a call of this turn; or `history`: the result's own envelope lists one, when its call has no coverage row |
| `declared-absent` | 3 | `coverageDeclared`: an absence; or `history`: an empty rowset inside a declared `coverage()` boundary, or an absence in the result's own envelope when its call has no coverage row |
| `empty-undeclared` | 3 | `history`: an empty rowset (a top-level array, the app's `rowsAt` key, or the dataset ticket left where those rows were, counting 0) whose call has no coverage row |
| `period-not-held` | 3 | `findingsLedger`: a `period` row of this turn with verdict `not-held` — the store holds none of what the read asked for (honesty step 7b) |
| `period-partly-held` | 3 | `findingsLedger`: a `period` row of this turn with verdict `partly-held` |
| `period-unknown` | 3 | `findingsLedger`: a `period` row of this turn with verdict `unknown` — the tool declared `held: 'unknown'`, on a non-empty result too (adopted Q33) |
| `period-undeclared` | 3 | `findingsLedger`: a `period` row of this turn with verdict `undeclared` — the tool declares a `ToolPeriod` and its result declared no period |
| `period-differs-from-asked` | 3 | `findingsLedger`: a `period` row of this turn with `differs` (the time layer, step T8 — `time/check.ts` · `periodTimeCheck`): what the call read is not the range it asked for — `missing` (asked, not read) or `extra` (read, not asked; TQ8: "not sure" too) — or, for a window the model chose, not the person's window. Witnesses: the row and the call's `argument` row |
| `period-beyond-retention` | 3 | `findingsLedger`: a `period` row of this turn with `beyondRetention` (step T8): the window was wholly older than the tool declares its source keeps — refused before dispatch, or read that way |
| `sources-conflict` | 3 | `findingsLedger`: a conflict row of this turn — one whose witnesses name a call of this turn, or one stamped with this turn whose witnesses the record does not all place in earlier turns (the incomplete-record policy, below) |
| `value-unsupported` | 4 | `unsupportedValues` (`revised: false`) |
| `value-survived-revision` | 4 | `unsupportedValues` (`revised: true`) |
| `derived-from-reading` | 4 | `findingsLedger`: a `time-derived` row of this turn — the answer states a time value no tool result carried that the library itself spelled from a reading of the person's words (an implied year, an offset, the end-of-grain minute, the served time line; the time layer, step T7 — `time/forms.ts` · `timeFormsOf`). Folded like `argument-assumed`: "not sure", never "known" |
| `script-unmatched` | 4 | `findingsLedger`: a `script-shown` witness row of this turn with `label: 'unmatched'` — a fenced block the answer showed equals no program this turn's calls submitted to a declared code-running tool (`.namesAndNumbersFromEvidence({ code: 'match' })`, filed while the answer layer is armed — `../scripts/README.md`). Its own reason: a script can miss while every number is in a result. A matched block fires nothing and supports nothing; every block files the `script-match` check |
| `stopped-early` | 4 | `stoppedEarly` |
| `steps-unfinished` | 4 | `findingsLedger`: a `steps-unfinished` witness row of this turn — the answer came before the active skill's declared steps finished (filed while the answer layer is armed) |
| `negative-prose-unverified` | 4 | `findingsLedger`: a `negative-claim` or `negative-claim-note` row of this turn. Model prose is observe-only; detected negatives and skipped scans remain not-sure, never verified or blocking. |
| `claim-exceeds-search` | 4 | `answerValidation.checks`: an `agent:negative-claims:` row with `disposition: 'checked-fail'` — a typed negative claimed more than the admitted search |
| `declaration-overclaimed` | 3 | `answerValidation.checks`: an `agent:negative-claims:` row with `reason: 'declaration-overclaimed'` — a tool's refusal said more than it read (`.negativeClaims()`); the row's `tools` name the tool |
| `answer-check-failed` | 4 | `answerValidation`: `status: 'failed'` |
| `check-unreachable` | every | `answerValidation`: `status: 'unverified'` — an armed check that could not reach a verdict — or a `failed` report that also counts `unreachable` checks or names a `reason` (a contradiction found beside them, or beside a validator that did not finish; both reasons fire) |
| `invariant-violation` | 1 | `findingsLedger`: an `integrity-finding` row of this turn (`integrityReasons.ts`, filed while the answer layer is armed) — the tools offered to the model contradict what the run composed or parked, at the write that served them (`seam: 'compose'`) or on the wire (`seam: 'wire'`) |
| `unsupported-argument` | 2 | `findingsLedger`: an `integrity-finding` row of this turn — a call chose an argument value nothing served it; the row names the tool, never the value |
| `column-type-mismatch` | 3 | `findingsLedger`: an `integrity-finding` row of this turn — a column holds something other than the type its tool declares |
| `missing-column` | 3 | `findingsLedger`: an `integrity-finding` row of this turn — a column its tool declares is in none of the rows |
| `unsupported-claim` | 4 | `findingsLedger`: an `integrity-finding` row of this turn — a `.claims()` field disagrees with the fact the run's tools settled, or declines to state it (the row's `advisory`) |
| `claim-unsettled` | 4 | `findingsLedger`: a `claim-unsettled` row of this turn — the answer states a `.claims()` field whose fact no tool settled, or no value could be read from the answer at all, so nothing could compare it |
