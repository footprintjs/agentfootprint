**Fold** — the ledger's checks: each rule reads one subject (a note, or the draft) against its
receipts and gives a disposition, a verdict and a decision record.

# `llm-ledger/rules/` — the checks port and the three built-in rules

| File | Owns |
|---|---|
| `port.ts` | the port: `LedgerTableRule` (facts and a `decide()` table) and `LedgerCodeRule` (its own code); `registerRules` (refuses a bad id, a duplicate, a branch or default that is no disposition, a function rule, more than 16 rules, more than 32 fact names); `runRule` (never throws); `verdictOf` and `weakest` |
| `cited.ts` | `cited@1` |
| `traceableValues.ts` | `traceable-values@2` |
| `valueEvidence.ts` | Literal and timestamp matching over admitted tokens |
| `valueTime.ts` | Written time precision, supported clock spellings and adjacency in the original statement |
| `timeWindow.ts` | `time-window@1` |

## One law, two doors

A **table rule** states flat facts and a table in `decide()`'s grammar, filter rows only. The ledger runs
`decideFromFacts(table, facts, default)` from `footprintjs`, which masks every value, and stores
`decisionRecord(evidence)`: `{ strategy, by: 'rule' | 'default', rule?, label?, reads }`, where `strategy`
is the disposition. A **code rule** decides with its own code; its record is
`fixedRecord(outcome, label, 'app')`. The evidence itself is never stored.

A rule runs on the trusted side, on real values, frozen: the subject (a note, or the draft's text), its
receipts (the cited ones for a note, all of them for the draft) and the session's supplied entries. What
it gives is reduced to words, numbers, seqs and a decision record before anything is stored. A rule that
throws, runs past 1,000 ms (`ruleTimeoutMs`) or answers something malformed (an unknown branch, a
`restsOn` outside its receipts, facts the engine refuses) gives `unreachable`, verdict `open`, `why`
`rule-threw`, `rule-timeout` or `bad-result`, no decision and no message: a rule's failure never turns
into `verified`, and its message can quote a value.

An id is `^[a-z][a-z0-9-]{1,47}$` for a built-in and `namespace/name` for a host rule, so a host rule
can never take a built-in's name; a check stores `rule: '<id>@<version>'`.

## The verdict

`verdictOf(disposition, restsOn)`: `checked-pass` is `verified` only when it rests on receipts and every
one of them is observed, else `consistent-with-reported` (a pass resting on nothing is no observation,
chosen here); `checked-fail` is `unsupported`; `unreachable` is `open`; `not-applicable` gives none. A
claim's verdict is the weakest of its rules': `unsupported`, then `open`, then
`consistent-with-reported`, then `verified`. The fold (`report.ts`) adds one law: a claim with no
visible token is never a pass.

## The three built-ins

**`traceable-values@2` runs in every session for new checks**, on every claim and ruled-out note and
on the whole draft, whatever the session pins: pinning may add rules, never remove this one. `open` records
it in `opened.rules` whatever the host asked for, and its reply lists the rules the session runs.

| Rule | Applies to | Table (first match wins) | Sees | Cannot see |
|---|---|---|---|---|
| `cited@1` | claim, ruled-out | `cites eq 0` → checked-fail, "cites no receipt". Default checked-pass, "cites a receipt of its session". Rests on the cited receipts | the note's `cites` | whether a receipt is about the claim |
| `traceable-values@2` | claim, ruled-out, draft | `visible eq 0` → unreachable; `checkable eq 0` → unreachable ("every value it states was supplied"); `unsupported gt 0` with `incomplete eq 0` → checked-fail; remaining missing values → unreachable when a time needs more evidence or when receipts are incomplete; `unreadable gt 0` → unreachable ("it states a value this rule cannot read"). Default checked-pass. Each token rests on the first observed receipt that holds it, else the first reported one | tokens by the ledger's one token rule (`tokens.ts`), from the note's text and `values` or the draft; that the subject states a value it cannot read (a number with thousands separators, a piece after an escape), which caps the subject at `open` after its visible tokens are checked | the value of a number written with thousands separators or of a piece after an escape (it is counted, never read); all-letter names; numbers under 4 digits; non-time respellings; meaning |
| `time-window@1` | a note with a `window` (else not-applicable) | `windowed eq 0` → unreachable; `uncoveredMs gt 0` with `unwindowed gt 0` → unreachable; `uncoveredMs gt 0` → checked-fail; `cutInWindow gt 0` → unreachable. Default checked-pass. Rests on the cited receipts whose windows overlap the claim's | the claim's typed window, the cited receipts' declared windows and `isIncomplete` | times written in prose; whether the rows really span a declared window; zones and wall times |

A complete timestamp can match the same instant across written offsets, at the precision the statement wrote. A clock without a date can match when its cited receipts resolve it to one instant at that precision. Conflicting dates and plausible evidence without an offset leave it open. An invalid time or a clock that cannot match any cited receipt is missing. The rule can read spaces and a zone suffix from the statement’s own bounded text. The stored receipt uses only the tokens it retained. Earlier `traceable-values@1` checks are read as recorded.

UTC and explicit supported offsets can establish an instant. A recognized but unresolved zone spelling
leaves the clock open; it never silently becomes a clock with no zone. A dateless numeric offset must
use a civil quarter-hour offset within ±14 hours, so a clock range such as `02:14-02:20` is not an offset.
A duration written as a clock (`took 02:14`) can match by respelling; the rule does not read intent.

A token found only in a `supplied` entry is exempt: neither missing nor support, and only the host
writes `supplied`. A note's own `values` are what it claims, never support. An incomplete receipt
(`isIncomplete`: cut, masked, limited, holding grouped numbers or escaped pieces) turns a missing value
into `open`, never `unsupported`.

A synchronous rule is timed only after it returns: one that never returns blocks the process. Each rule has an
independent oracle in `test/llm-ledger/rules-oracle.test.ts`.
