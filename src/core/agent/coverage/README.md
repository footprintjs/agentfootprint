**Mixed** — two declarations a tool authors, one reader the walk calls, one
sentence the model keeps.
Map: `types.ts`, `items.ts`, `absent.ts`, `ledger.ts` (what a tool declares).
Walker: `read.ts` — the ONE reader both dispatch boundaries and the raise site
(`../stages/toolCalls.ts` · `declareRaisedAbsence`) call.
Fold: `evidence.ts` (`absenceEvidenceProjection` — what an absence may ground).
Lens: `answer.ts` · `composeAnswerWithCoverage`, the coverage block appended to
the final answer so the model cannot drop it.

# `coverage/` — an absence that names itself, and a limit that travels

Two result primitives, both **invented in field use** on a live triage agent
before this library had any answer for either. We copied them; the credit
belongs to the field.

| | says | door |
|---|---|---|
| `absent()` | "I looked HERE, and there is nothing" | tool result, or a `requestInput` declaration's `absence` (§ 4) |
| `coverage()` | "my verdict covers THIS and not THAT" | tool result |

## 1. `absent()` — the direction of the error is the argument

A tool that finds nothing returns *something*: an empty array, a `null`, a
sentence. From any of those a model cannot tell **"I looked and there is
nothing"** from **"I could not look"**.

That confusion is not symmetric, which is why it is worth a primitive:

- a *nothing-found* misread as an *outage* sends an engineer to investigate a
  collector that is working perfectly — expensive, and self-correcting;
- an *outage* misread as *nothing-found* declares a system healthy that was
  **never checked** — cheap, silent, and wrong in the direction that hurts.

So an absence must not share a shape with an error. An error is a result with
`error: true`, a message, and no coverage. An absence carries three things a
`null` cannot:

1. **the coverage** — which sources, which window, which population;
2. **that a retry returns the same** — the loop this ends is a model re-asking
   the identical question because a mismatch looked like a fluke;
3. **a shape distinct from an error** — recognized by the framework, not by
   convention.

```ts
return absent({
  what: `FLOGI entries on ${port}`,
  checked: [`${sw}: the live fcns database`, 'window: the last 24h'],
  notChecked: [{ what: 'the archived FLOGI history', why: 'older than the 24h window' }],
  cannotCover: [{ what: 'ports on the peer fabric', why: 'this collector is scoped to one fabric' }],
  tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
});
```

## 2. `coverage()` — what a clean result does NOT rule out

"Everything looks fine" is produced from the checks that ran, and arrives with
no way to tell whether *fine* means **verified** or **unexamined**. A ledger is
three lists the tool knows and the model does not — and only the tool knows the
third, which is why this cannot be prompt engineering.

```ts
return coverage(verdict, {
  checked: ['SRDF pair state on all 4 arrays (live query)'],
  notChecked: [{ what: 'NDM migration sessions', why: 'the API timed out — ask again' }],
  cannotCover: [{ what: 'host-side multipathing', why: 'no collector runs on the ESX hosts' }],
});
```

It is the sibling of the evidence gate (9.35.0): **the gate catches invented
VALUES, this catches unstated LIMITS.** Both are ways an answer can be false
while every token in it is real.

## 3. A suggestion to try another tool is typed, never parsed out of prose (9.113.0)

**The law.** When an absence points at another TOOL, the name is data —
`tryInsteadTool: { tool, why? }`, beside the `tryInstead` sentence. Nothing in
this library reads a tool name out of the sentence, and nothing will: a name
found inside prose is an inference, and a reader that acts on it acts on a
guess.

`tryInstead` is one sentence, for the model. A recorded collector absence
said (tool name generalised):

```ts
return absent({
  what: `latency samples for cluster ${cluster}`,
  checked: [`collected latency samples over the last ${window}`],
  notChecked: [
    { what: 'whether the cluster exists at all', why: 'this reads collected samples, not the cluster' },
  ],
  tryInstead: 'Widen the window, or check cluster_inventory for the collected cluster names.',
});
```

A model can follow that. A reader cannot: to learn WHICH tool was suggested it
would have to parse the sentence. The same absence, with the tool named as
data beside the sentence:

```ts
return absent({
  what: `latency samples for cluster ${cluster}`,
  checked: [`collected latency samples over the last ${window}`],
  notChecked: [
    { what: 'whether the cluster exists at all', why: 'this reads collected samples, not the cluster' },
  ],
  tryInstead: 'Widen the window, or check cluster_inventory for the collected cluster names.',
  tryInsteadTool: { tool: 'cluster_inventory', why: 'it lists the collected cluster names' },
});
```

The sentence stays exactly as it was — it is what the model is told, "widen
the window" included — and the tool rides its OWN key, `try_instead_tool`,
never `try_instead`. That field has been a string since it shipped and every
reader typed against `ToolAbsence` reads it as one; a second shape there
would be dropped by each of them without a word. So a reader of the sentence
keeps the sentence, and a reader of the tool takes the name without parsing.

What each reader gets:

| reader | `tryInstead` — the sentence | `tryInsteadTool` — the tool |
|---|---|---|
| the model (the `af_absent` JSON) | `"try_instead":"Widen the window, or …"` — byte-identical to 9.112.2 | `"try_instead_tool":{"tool":"cluster_inventory","why":"it lists the collected cluster names"}`, right after `try_instead` — the author's words; the library composes no sentence for it |
| `agentfootprint.tools.absent` | `tryInstead: '<the sentence>'` | `tryInsteadTool: { tool, why }`, a copy |
| the evidence corpus | the sentence grounds | `tool` and `why` ground; `looked_for` is still the one field withheld |
| a dataset projection's guard (`lib/semantics/projection.ts`) | a declaration no adapter may change | the same |
| `coverageDeclared` and the appended block | never carried | never carried — a suggestion is advice about a call not yet made, not ground the answer stands on |

**What this release does with the name, and what it does not.** The name is
carried (the event) and rendered (the envelope). Nothing JOINS it yet: the
reader that would match `tryInsteadTool.tool` against the calls a run made —
the design's `source-not-consulted` reason
(`docs/design/2026-09-honest-answer-ledger.md` § 5.2) — is the second half of
the typed vocabulary and lands with the assessment. What ships now is its
precondition: the name that join will read is one the author declared, never
a word found in a sentence.

The rules are checked where you type them (`absent()` throws, naming the fix),
and an envelope minted anywhere else — a tool in another language, a
hand-built value — is read by the SAME rules (`absent.ts` ·
`tryInsteadOfAbsence`, `absent.ts` · `tryInsteadToolOfAbsence`): a value
`absent()` would refuse is not read, and nothing warns — the absence is still
an absence, and the tool turn in history still holds the envelope as the tool
returned it.

- **Either, both, or neither.** Write the sentence when the model should be
  told in words; add the tool when the sentence points at one. The tool alone
  is allowed — the model reads the object — but a reader that quotes the
  suggestion as prose quotes the sentence, so a tool with no sentence gives it
  nothing to quote. When you give both, they must name the same tool: the
  model reads both, and the library cannot check that they agree, because
  checking would mean reading a tool name out of the sentence.
- **One tool.** A list is refused: every suggestion written in this
  repository, and the recorded one above, names at most one other tool, and
  the rest of the advice stays in the sentence. A second shape of this field
  would be one more for every reader to narrow — the cost its own key exists
  to spare `try_instead`.
- **`tool` is a non-empty name, recorded as declared.** It is not looked up (a
  provider may serve it on a later iteration), and it is held to no charset
  here: which names a provider accepts is `core/tools.ts` ·
  `assertValidToolName`'s question, and `absent()` asks the owner's dev-mode
  warning, `warnIfInvalidToolName` — the verdict a `defineTool` of that name
  would get, a warning and never a refusal.
- **`why` is optional**, and says something when given.
- **No other key** — a misspelt `why` is refused rather than dropped. A
  suggestion that needs arguments ("call it with `group_by: 'job'`") says so
  in the sentence.
- **`null` reads as not given** — for `tryInstead`, `tryInsteadTool` and
  `why`, at the mint and at the read. `tryInstead: null` read as no suggestion
  before 9.113.0, and a JSON producer writes a missing optional value as
  `null`; refusing it would turn a nothing-found into a tool error.
- **A plain object in the sentence slot is refused**, and pointed at
  `tryInsteadTool` — it is the typed form written where the sentence goes, and
  dropping it would lose the author's tool without a word. **Any other
  non-string `tryInstead` reads as no suggestion**, as it did before 9.113.0:
  `false` from `tryInstead: cond && '…'`, a number, a list, a Date. `absent()`
  runs inside a tool's `execute`, so refusing those would turn a nothing-found
  into that call's error result. A `tryInsteadTool` that is not
  `{ tool, why? }` is refused — a key new in 9.113.0 has no earlier behaviour
  to keep.
- **Not the coverage lists' rules, on purpose.** A coverage item's `why`
  (`items.ts` · `normalizeCoverageList`) refuses `null` and drops an unknown
  key; the typed tool's `why` reads `null` as omitted and its object refuses
  an unknown key. The lists' rules are older than this key and changing them
  would change what existing declarations mint; the typed tool had no earlier
  callers, so it takes the stricter reading of a misspelling and the JSON
  reading of `null`. On the read side the typed tool is all or nothing — a
  `why` these rules refuse (an empty string, say) keeps the whole typed tool,
  name included, off `tools.absent` (the sentence is read on its own), while a
  coverage item's `why` is served as the envelope holds it.

### `short` and `kind` — for the person reading the report, never for the model

A coverage item's `what` is written for the MODEL and for an engineer: it
names the tables it read ("vDisk and vm_rdm_map: every VM disk in the RVTools
export dated 2026-09-19"). A person reading a report of the answer wants the
same ground in five words, and wants to know whether an unchecked item is the
one that matters most — whether the thing asked about exists at all. Two
optional item fields say so, and the answer account
(`lib/answer-account` · `accountForAnswer`) is their reader:

- **`short`** — a short plain form of `what`. At most 80 characters, one line,
  never longer than `what`; allowed in every section.
- **`kind`** — what kind of ground an UNCHECKED item is: `'existence'`
  (whether the thing asked about exists, or is the kind of thing the question
  assumes) or `'scope'` (a population, family or source outside what this tool
  reaches). On `notChecked` and `cannotCover` only — refused on `checked`.

```ts
return absent({
  what: 'a VM disk in the RVTools export attributed to the array asked',
  checked: [{ what: 'vDisk and vm_rdm_map: every VM disk in the RVTools export dated 2026-09-19',
              short: 'every VM disk in the RVTools export of 2026-09-19' }],
  notChecked: [
    { what: 'whether that name is a storage array, and which VM disks are on it',
      short: 'whether that name is a storage array', kind: 'existence', why: '…' },
    { what: 'hosts that are not VMware — AIX LPARs and physical servers',
      short: 'hosts that are not VMware', kind: 'scope', why: '…' },
  ],
});
```

A tool in another language puts the same two keys on the envelope's items,
under the snake_case lists (`checked` / `not_checked` / `cannot_cover`):

```python
{"af_absent": True, "outcome": "nothing_found", "looked_for": "…",
 "checked": [{"what": "…", "short": "every VM disk in the RVTools export of 2026-09-19"}],
 "not_checked": [{"what": "…", "short": "whether that name is a storage array",
                  "kind": "existence", "why": "…"}],
 "retry_returns_the_same": True, "note": ABSENCE_NOTE}
```

The laws:

- **Record-only.** Both reach the events (`tools.absent`,
  `tools.coverage_declared`), the tracked `coverageDeclared` rows and the
  account — never the model's request. `read.ts` · `servedToModel` removes
  them from every recognized envelope (a bare absence, a ledger's own lists
  AND the absence it bounds, a semantic envelope's `coverage`), and
  `../stages/toolCalls.ts` · `afterMoment` asks it FIRST, so all five
  dispatch paths strip and every after-tool link is handed the served value.
  Where the two differ, `tool_end.modelResult` is stamped — the envelope then
  rides the record twice (about 4 KB more per declaring call). A tool that
  declares neither gets the same reference back: no stamp, no new byte
  (pinned against the pre-change tree by
  `test/core/agent/coverage-record-only-fields.test.ts`). A result returned as
  JSON TEXT is never recognized at the door, so it is served as written.
- **One rule set, two doors.** `absent()` / `coverage()` refuse a bad value
  where it was written (`items.ts` · `normalizeCoverageList`). An envelope
  minted elsewhere is read by `items.ts` · `readItemExtras`: a valid value is
  copied, an invalid one DROPPED — read, never repaired — with one dev warning
  per tool. A Python author never sees that warning, so validate at the call
  site too. `null` reads as omitted.
- **Never evidence.** `evidence.ts` withholds both beside `looked_for`. `short`
  is the field an author is most tempted to personalise, and a true short form
  restates `what`, so nothing is lost. **Never interpolate the caller's
  arguments into `short`.**
- **Never inferred.** No `short` → a report prints the full `what`. No `kind` →
  no kind is claimed, and the account's existence check says it cannot tell.
- **The first declared wins on a repeat.** Identity stays `what` + `why`
  (`items.ts` · `sameItem`), so two equal items that differ only in `short`
  or `kind` fold to the FIRST one in `mergeItems` — which is what a band folding
  `coverageDeclared` shows. The per-call events keep each call's own.
- **A closed union, never switched on exhaustively.** Every library switch
  over `kind` keeps a `default` arm (pinned), so a later member (`'window'` is
  the named candidate) is additive for producers.
- **The limits block is unchanged** — `answer.ts` · `renderSection` prints
  `what` and `why` only.

## 4. A lookup that pauses still declares what it looked at (9.114.0)

Why: some misses cannot be answered without the person — the lookup searched
one fabric, found nothing, and needs to be told which fabric the host is
cabled to. So it raises `requestInput` about its miss. (A dedicated
collection tool that asks BEFORE the query runs stays the documented shape —
`../../pause.ts` · `requestInput`; this section is the case where a lookup
has already looked when it asks.) Before this release
that miss left no record: the dispatch door reads coverage off a RETURNED
value (`../stages/toolCalls.ts` · `declareCoverage`), and a pause returns its
checkpoint before the door is reached. No `tools.absent`, no
`coverageDeclared` row, nothing for a coverage band — and the app could not
file it, because the declaration's `context` rides to the model on resume,
never to the record. Only the raise site can. The law:

> **A lookup that pauses still declares what it looked at.** The miss rides
> the declaration as data — `absence`, the envelope `absent()` returns — and
> is filed at the raise: byte for byte what the same `absent()`, returned,
> would file.

```ts
defineTool({
  name: 'port_for_device',
  description: 'Which port a device is logged in to.',
  inputSchema: { type: 'object', properties: { wwpn: { type: 'string' } }, required: ['wwpn'] },
  execute: ({ wwpn }) => {
    const rows = fabricA.logins(wwpn);
    if (rows.length > 0) return rows;
    return requestInput({
      id: 'fabric',
      question: `No logins for ${wwpn} on fabric A. Which fabric is the host cabled to?`,
      fields: [{ id: 'fabric', type: 'string', required: true }],
      absence: absent({
        what: `port logins for ${wwpn}`,
        checked: ['the live name-server database on fabric A'],
        notChecked: [{ what: 'fabric B', why: 'nobody has said the host is cabled there' }],
      }),
    });
  },
});
```

- **One recognizer, at raise time.** The declaration's one validator
  (`../../inputRequest.ts` · `validateInputDeclaration`) asks
  `absent.ts` · `readAbsence` and refuses what it does not read — an
  `InputRequestError` naming `absent()`, thrown from `requestInput`, so the
  call errors like any malformed declaration and nothing pauses. `null` is
  the field omitted, not a refusal — this module's rule for a missing
  optional value (`absent.ts` · `notGiven`); it carries no miss to file. A
  `coverage(absent(…), …)` ledger is not an absence to that reader, so it is
  refused too: the field carries the miss, not a boundary drawn around it.
  An envelope that reader DOES read is held as handed over, never repaired —
  so a hand-built one can carry lists the door cannot copy
  (`checked: [null]`, `not_checked: 5`). That is not refused at
  `requestInput`; it meets the door at the raise inside the returned path's
  containment: the call errors with the text the same value returned would
  give, nothing pauses, nothing is filed, and the run goes on.
- **Filed at the raise, by the returned path's readers, before anything is
  written for the pause.** The batch loop's pause branch
  (`../stages/toolCalls.ts` · `declareRaisedAbsence`) runs `declareCoverage`
  over it — the same `tools.absent` payload and `coverageDeclared` row a
  lookup returning the same `absent(…)` files — and, when the tool is
  grounded (`argumentsFrom` under `noticeEmptyLookups`), the empty-lookup
  write seam, with the envelope as the tool's own answer, in that order.
  Nothing that judges a SERVED result runs at the raise, because nothing is
  served for the paused call — four things a returned absence gets and a
  raised one does not: no delivered status (a paused call is not settled, so
  there is no `tool_end` to carry `'absent'`, and an `onToolStatus` route
  keyed on `'absent'` does not fire for it); no `resultCeiling` judgment (the
  tool's ceiling measures a served result — a lookup whose ceiling refuses
  its returned envelope, which leaves the seam `not-applicable`, is read by
  the seam at the raise); no column-type contract (`resultColumns` under
  `checkColumnTypes` — a returned envelope is noted `not-applicable` on
  `column-type-mismatch` and `missing-column`, a raised one leaves both
  unnoted); and no evidence (the envelope never enters the corpus, so none
  of its words ground an answer value).
- **Read once, then never.** The rows are tracked state, so they ride the
  checkpoint: under `.limitsTravelWithTheAnswer()` the resumed run's answer
  carries the same block a returned miss gives. The field does not:
  `../../inputRequest.ts` · `stampInputRequest` leaves it off, so
  `awaitingInput` — what the person, the model and the durable pause read —
  never carries it, and `readAwaitingInput` re-validates the same five keys.
  Nothing on resume reads it; the paused call's served result is the
  person's `InputResponseResult`, and the rows are filed once. If the person
  should hear about the miss, say it in `question`.
- **A raise inside a composed call is the OUTER call's raise.** A lookup
  reached through `ctx.tools.call`, a runbook procedure or a
  `flowchartAsTool` stage throws its request up through the tool that called
  it, so the batch loop meets it as that outer call pausing: the rows name
  the OUTER tool and call id, the empty-lookup seam judges it by the outer
  tool's `argumentsFrom` and the outer call's arguments, and it is filed
  once. That is the call that paused, and the same place a returned absence
  lands when an outer tool passes the inner result through as its own. The
  runbook's and the flowchart's own kept record of that call says `'error'`
  (they record the throw and rethrow it).
- **Unchanged without it.** A raise that declares no `absence` (or
  `absence: null`) records what 9.113.0 recorded, because only a declaration
  that CARRIES one is judged before the pause writes. A malformed hand raise
  — a `pauseHere`/`askHuman` whose `inputRequest` never went through
  `requestInput` — leaves the committed record it always left, WHETHER OR NOT
  it carries `absence`: its error leaves the stage only after the pause
  writes are made (`../stages/toolCalls.ts` · `writePause`), so the failed
  run's record keeps the in-flight batch (the assistant turn, every sibling's
  result, the paused keys). Its error TEXT can differ from 9.113.0's where
  9.113.0 stopped first at the then-unknown `absence` key. All pinned against
  references captured on the 9.113.0 tree.
- **Not covered, named here so nobody reads it as covered:**
  - a raise the library refuses — a tool that pauses on any RESUMED dispatch
    (an approved middleware ask, an approved check-in, granted credential
    consent — all three run `../stages/toolCalls.ts` ·
    `resolveCredentialAndExecute`, whose pause catch refuses every pause,
    worded for a check-in): that call settles as an ERROR, and an errored
    call files no coverage on any door;
  - the unsettled-by-absence row (`../findings/README.md`): its rule needs
    the SERVED result to read as an absence, and a paused lookup is served
    the person's answer — so a ruling-out on it files no row, although the
    door's rows now hold its miss. The rule is unchanged;
  - `pauseHere` / `askHuman`: only an input request carries a declaration,
    so only it carries the field.

Pinned by `test/core/agent/coverage-paused-lookup.test.ts`.

## What the framework does with them

Recognition is STRICT (the effects-envelope law): only a plain object carrying
the reserved `af_absent` / `af_coverage` key is one. Every other shape any tool
has ever returned takes the path it always took, byte for byte.

The table is what a RETURNED absence gets; a raised one (§ 4) differs in four
ways — no delivered status, no ceiling, no column-type contract, no evidence.

| | on an **absence** | on a **ledger** |
|---|---|---|
| delivered status | `'absent'` — the seventh `ToolResultStatus`, routable by `onToolStatus` | unchanged |
| event | `agentfootprint.tools.absent` | `agentfootprint.tools.coverage_declared` |
| tracked state | appended to `coverageDeclared` | appended to `coverageDeclared` |
| evidence corpus | grounds **every field but `looked_for`** | indexed as ordinary data |
| final answer | folds into the block, with `.limitsTravelWithTheAnswer()` | same |
| suggestion (`tryInstead`, `tryInsteadTool`) | rides `tools.absent` as declared (9.113.0); never tracked, never appended | — (a ledger makes none) |

### What deliberately does NOT change

- **Nothing retries it.** No reliability rule, no re-ask, no loop. An absence
  that read as a failure to a retry policy would loop exactly where it must not.
- **Nothing fails.** `error: true` is never set, the after-tool chain runs as
  normal, and the step pointer advances — the call ran and answered.
- **The gate does not flag it.** An absence is not an unsupported value.
- **The ceiling still measures it** (a returned one — § 4 for a raised one),
  and coverage is declared BEFORE the
  measurement, so a limit does not die with an oversized payload (the same law
  the effects channel already has).

### The one sharp edge: laundering

The evidence corpus is every `role: 'tool'` result. An absence's job is to say
what was looked FOR — which in practice quotes the arguments the model passed.
Indexed whole, an invented identifier would become **grounded** by the one
operation that proves nothing about it: a lookup that found nothing. It is
`evidence/frames.ts`'s argument on the tool side of the conversation.

The line is **tool-authored knowledge vs caller echo**, not "coverage vs the
rest". `looked_for` is withheld and nothing else is (`evidence.ts`): the
coverage lists, the `note`, `try_instead`, `try_instead_tool` (its `tool` and
`why` ground as the sentence does), and any extra key the tool attached to the
envelope all ground. The first cut drew the line at the coverage lists
and the field found the hole — a lookup tool returned its absence with the 40
real share names attached under `known_shares` and a `try_instead` telling the
model to pick one; the model did, and the gate called the answer ungrounded.
An answer that follows the absence's own advice must not be flagged for it.

If the user named the value, it is exempt anyway. Only a value appearing for
the first time inside an absence's `looked_for` loses grounding — the case
where it was never evidence to begin with.

**What that does not close.** The rule rests on "everything but `looked_for` is
the tool's own words about the world". An author who string-interpolates an
unvalidated argument into any other field puts a model-supplied token back into
the corpus, and no library can tell which characters of a sentence a tool
composed and which it copied. Interpolate identifiers you RESOLVED, not
identifiers you were handed. It is the general limit of the evidence corpus
rather than a new one — any tool that echoes its arguments into its result has
always grounded them.

## Survival: appended, not requested

A ledger the model can drop is worthless, and *every* mechanism that ASKS the
model to carry it can be dropped — a note in the result is advice, a prompt rule
is advice, and a judge that reads the answer back to ask "did it state its
limits?" needs a second model to decide what counts, which is the one thing this
library refuses to put in a guard.

So `.limitsTravelWithTheAnswer()` **appends**. The framework composes the block
from what the tools declared and concatenates it onto the final answer. The
model does not write it, so the model cannot drop it. It changes the answer's
bytes, which is why it is opt-in; the recording half runs either way.

It is **not** enforcement of the model's prose. It does not check that the model
stated the limits, and it does not refuse an answer that did not.

## Files

| file | one job |
|---|---|
| `types.ts` | the shared vocabulary — `CoverageItem`, the three lists, the two rendered shapes, the typed suggestion (`TryInsteadTool`) |
| `items.ts` | normalize and REFUSE a declaration, at the call site |
| `absent.ts` | `absent()`, the recognizer, the static note, and the ONE rule set for a suggestion (`tryInsteadOfAbsence` and `tryInsteadToolOfAbsence` read by it) |
| `ledger.ts` | `coverage()`, the recognizer, the static note |
| `read.ts` | the ONE reader both dispatch boundaries and the raise site (`../stages/toolCalls.ts` · `declareRaisedAbsence`) call — lifts the suggestion beside the coverage |
| `evidence.ts` | what an absence is allowed to ground |
| `answer.ts` | folding the run's declarations into one appended block |

## The notes cross a language boundary (9.70.0)

`ABSENCE_NOTE`, `COVERAGE_NOTE` and the two markers are bytes, not prose: the
recognizers take the markers verbatim and the docs promise the notes word for
word. A tool that is not JavaScript has to reproduce them exactly, and the
only door this package used to offer was the compiled ESM — which a Python
sidecar regex-scraped at import time. Right instinct, wrong door, our fault.

They are now also published as data at the package root, in
`canonical-notes.json` (with `SEMANTICS_NOTE` / `SEMANTICS_MARKER` from
`lib/semantics/` and `COVERAGE_BLOCK_HEADING` from `answer.ts`).
**Do not hand-edit that file** — `scripts/gen-canonical-notes.mjs` regenerates
it from the BUILT barrel on every `npm run build`, so it cannot disagree with
the constants here, and `test/docs/canonical-notes.test.ts` fails if it does.
Renaming or un-exporting one of these constants is therefore a breaking change
for consumers in other languages, not only for TypeScript importers.

## Zero-cost when unused

An agent whose tools return neither shape is byte-identical: two `typeof`
checks per result and `undefined` back, no scope key, no event, no chart
difference (the final branch mounts the stage function it always mounted).
Pinned by `test/core/agent/coverage-zero-cost.test.ts`.
