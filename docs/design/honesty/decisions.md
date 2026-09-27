# Honesty layers — the decisions

**Adopted overnight 2026-09-27 on the owner's go; the owner may overturn.**

This page records what was decided for the honesty layers: the owner's framing of 2026-09-26,
which the three design pages were written to, and the 43 questions those pages put, each with the
answer it took. The go reached this page through the overnight build's task; the owner's own review
of this page is the confirmation, and any answer here can be overturned.

- The questions are numbered once across the three pages, as the owner's summary of 2026-09-26
  numbered them. Each row names where the question was asked: the pages number their own lists
  (the architecture note Q1–Q12 and Q19, the inputs page Q2–Q19 and R1–R13, the results page
  Q1–Q12), so the same question can carry two numbers.
- Each answer is the one the owner's summary of 2026-09-26 recommended. Where a page's text and an
  answer here differ, the answer here wins.
- The pages: [the architecture note](README.md) · [choice](choice.md) · [inputs](inputs.md) ·
  [results](results.md) · [answer](answer.md).

---

## The go (2026-09-27)

- **Every recommended answer is adopted as the spec** — the 43 below.
- **The night's build is steps 0–4** of the plan ([README.md](README.md) § 7): this folder, the
  standing as a pure reader, the inputs bench and its baseline, the inputs layer's `assume`, and the
  one ask per batch for missing values. Step 7a (`describedResult()`) is on its own track and has
  merged (below).
- **Paid bench calls tonight** run on Haiku 4.5 only, within $15 in total across the night's steps,
  and none before the step's registered success rule is committed to a file. Any later budget is the
  owner's to set (Q12).

## Facts that changed since the framing

- **PR A (fix 0 and fix 1) has shipped** in 9.118.1 (`f83f277c`). The framing described it as still
  being built.
- **Step 7a, `describedResult()`, has merged to main** as #22 (`0600ab53`, late on 2026-09-26), on
  its own track. When the owner's summary was written it was a local draft (`d8258fd3` on
  `feat/described-result`, not pushed, no PR). The framing's rule was that the owner reviews these
  notes before any branch, PR or code is made, which is why the draft is Q37.

---

## The owner's framing (2026-09-26)

Decided in conversation on 2026-09-26, before the design pages were revised to it. The eight items
are the owner's, set in plain case, with a local file path replaced by the request's repository
name; a note in brackets marks what has changed since.

1. **The honesty layer over every model decision.** Every model decision is a claim: the model
   declares its grounds; the library verifies what it can, deterministically; the record keeps the
   verdict (one ledger, one writer, row kinds per layer); the standing (known / not sure + why /
   ask) folds from the record, never from model confidence; what cannot be settled is resolved by
   the library — ask the person automatically (the existing typed ask and pause) or carry the
   assumption with the answer. Four decision points: (1) choose a tool, (2) fill its inputs (new:
   the arguments layer — ask-or-assume per argument; declared provenance per value, with a verbatim
   quote of the person that the library checks), (3) read a result (the findings ledger — exists),
   (4) give the answer (the evidence gate, claims, the 9.114.x peel — exist).
2. **The self-report caveat, stated explicitly.** A declaration is worth only what the library can
   check; an unchecked declaration is recorded as unverified and never trusted. This is what
   separates the layer from confidence scoring, and it is the first thing a paper reviewer attacks.
3. **Benchmark first.** Each layer earns its place with a benchmark: provoking cases per decision
   point, a baseline measured without the layer, a registered success rule, before-and-after
   measurement; kept only if it shows a gain. Hosted runs use Haiku only, within an owner-approved
   budget. Examples: answer = the paper study's absent and wrong-kind cases; inputs = questions with
   no stated time, names the person never said; choice = wrong-kind entities, skills picked for the
   wrong estate. Past measured nulls to respect: the served findings piece showed no benefit at ten
   runs and cost fact fidelity; Haiku declared about half the time.
4. **What it lets you measure — end every layer page with this.** The ledger is a model-evaluation
   instrument: per layer, metrics read from the record alone (declaration rate, verified rate,
   assumed values, asks, unknown ids, contingent uses, answers exceeding their standing, grounded
   values) give a per-model honesty profile, comparable across models and across prompt and skill
   versions — the same rows in the bench, the paper and the Lens. Its limit: it measures honesty
   (claims within evidence), not truth. The paper's RQ3 (standing from the record against blind
   human labels) validates it as a cheap stand-in for human overclaim labelling.
5. **Each layer is a footprintjs subflow** mounted at its decision point, only when armed (a
   byte-identical chart when off — the WrapUp precedent): the inputs layer between CallLLM and
   ToolCalls, per batch (verify every call, ask once for everything missing, then dispatch), not per
   call; the results layer after ToolCalls; the answer layer between Route 'final' and Final. Inside
   each: Declare → Verify → Record → Resolve. Verdicts return through the subflow's output mapping
   into the one ledger (subflows run in isolated state; the Final subflow cannot write back — the
   reason the answer peel lives in the decider). No big-bang move: the existing pieces (the findings
   peel in ToolCalls, the evidence gate in the Route decider) stay; new layers are subflows from day
   one; old ones move only if a bench and a performance measurement say so. [Where footprintjs puts
   each mount is [README.md](README.md) § 5.2; the answer layer heads the final branch (Q3).]
6. **The tool-result stage page must carry the request**
   `agentfootprint-video-course:docs/library-requests/2026-09-26-typed-result.md`. The owner decided
   the name `describedResult()` (not `typedResult()` — "typed" collides with `runTyped()`); the
   three result doors `absent()` / `coverage()` / `describedResult()`; a camelCase declaration
   respelled to the unchanged snake_case wire; provenance required at compile time; the open
   questions (a shorter model note without a series; whether the model sees `describedResult()`'s
   `checked` list; `absent()` has no source or time; `/observe`'s `readEmptiness`). PR A (fix 0:
   refuse unknown and snake_case declaration keys; fix 1: the neutral `refused:` prefix) is being
   built separately. [PR A has since shipped in 9.118.1. The page is [results.md](results.md).]
7. **One time-coverage shape** shared by the result doors (the queried window, the held window,
   `'unknown'` said out loud) and the inputs layer's window declaration. [`DeclaredPeriod` and
   `ToolPeriod`, [results.md](results.md) § 3.]
8. **The owner reviews these notes before any branch, PR or implementation.** [The go of 2026-09-27
   above is the owner's word on the notes.]

---

## The 43 answers

### From the architecture note ([README.md](README.md) § 10)

| # | Question | Adopted answer | Asked in | Lands in |
|---|---|---|---|---|
| Q1 | The standing's values — known · consistent with the record · not sure · ask · not assessed — instead of the framing's three words | **Yes.** The two extra values stop an answer from reading "known" just because nothing fired, and name the case where nothing was checked. | architecture Q1 | § 4.2; step 1 (the reader), step 6 (in the run) |
| Q2 | Before sources can be declared, a present but unverified value on an `ask` argument | **Flag it and run.** Asking would fire on almost every call; step 4 measures needless asks. | architecture Q2 · inputs Q2 | step 4 (flag); step 5 asks under the sources arm |
| Q3 | Where the answer layer sits | **The first node of the final branch**, with its rows returned through Final's output mapping. footprintjs cannot place a separate node between a branch and its target. | architecture Q3 | step 6 |
| Q4 | The ask comes before the permission check | **Accept this for v1.** A call that is later denied keeps its `answered` row. Revisit if the bench shows asks on denied calls. | architecture Q4 · inputs Q4 | step 4 |
| Q5 | Filled values enter the call before the permission check | **Yes.** Policy then judges the call that will really run. | architecture Q5 · inputs Q5 | step 3 |
| Q6 | One ledger (`findingsLedger`, not renamed), a `turn` stamp, and a restore that works whenever any layer is on | **Yes.** | architecture Q6 | step 3 |
| Q7 | The `said` tier as one ordered chain: `claimed` ⊑ `said` ⊑ `answered` | **Yes.** | architecture Q7 · inputs Q7 | the argument row, steps 3–5 |
| Q8 | A middleware that rewrites a ruled argument | **Add a typed origin**, `allow(args, why, { from })`. A rewrite without one reads as assumed. The host needs it for its absolute windows. | architecture Q8 · inputs Q8 | the inputs layer; the rewrite reason is step 3's (§ 4.2) |
| Q9 | Composed runs (the patterns and the core-flow composers) mark their runs, so another model's message never counts as "the person said it" | **Yes.** | architecture Q9 · inputs Q9 | step 5 (`composed-message`) |
| Q10 | The public names: `askOrAssume`, `ToolPeriod`, `_findings.from`, `.findings({ argumentSources })`, `.inputsLayer()`, `agent.assessment()`, `argumentAskContext`, `argumentResolutions`, `toolChars`, `sf-inputs`, the event names, `resultCarries` | **Keep the drafts.** Each one is settled in its step's docs. | architecture Q10 · inputs Q10 | each step |
| Q11 | The request's `describedResult()` questions | The shorter note is Q35 and the `checked` list is Q36. **`absent()` gains `provenance` and the period in step 7b. `readEmptiness` becomes one shared reader in step 1.** | architecture Q11 | steps 1 and 7b |
| Q12 | Budgets | **The owner sets the Haiku budget** for the benches of steps 2, 4, 5 and 6 and for the results cells R1–R4. **Run step 1's parity test now** over the recorded runs ($0), and re-run it at the study's freeze. The overnight cap is under "The go" above. | architecture Q12 · inputs Q12 | steps 1, 2, 4, 5, 6; cells R1–R4 |
| Q13 | A `ToolPeriod` on an argument with no rule | **Keep the refusal in v1.** A period argument is exactly what ask-or-assume is for. | architecture Q19 · inputs Q19 · results Q12 | step 3 (refused at definition) |

Q13 is the results page's Q12 and the other two pages' Q19. It is listed once.

### From the inputs page ([inputs.md](inputs.md) § 10)

| # | Question | Adopted answer | Asked in | Lands in |
|---|---|---|---|---|
| Q14 | A ruled tool met while the layer is not mounted | **Refuse it** (fail closed). A setup that looks configured but does nothing looks exactly like one that works. | inputs Q13 | step 3 |
| Q15 | The app corpus includes memory recall and retrieval passages | **Keep them, and say so.** This matches what the evidence gate already reads. | inputs Q14 | step 5 (the `app` check) |
| Q16 | Library suffixes on messages the layer did not annotate | **Read them as today.** They carry names and counts, not argument values. | inputs Q15 | steps 3 and 5 (the tool-bytes boundary, the source checks) |
| Q17 | The re-ask bound | **Three rounds per field**, then refuse the calls that needed it. | inputs Q16 | step 4 |
| Q18 | A `from` entry on a free argument | **Check it and file it in v1.** | inputs Q17 | step 5 |
| Q19 | The explicit action (the no-model-hop draft) | **`assume` fills through the same function, and a missing `ask` value refuses the action.** This is decided on that page. | inputs Q18 | the explicit action's own page |

### Refinements to the architecture note ([inputs.md](inputs.md) § 10.1)

Yes to all thirteen. Each one fixes a named defect or a gap, and each is marked in the architecture
note's text where it touches it.

| # | Refinement | Adopted answer | Asked in | Lands in |
|---|---|---|---|---|
| Q20 | A `turn` claim resolves only to an earlier answer; any other match is a hint | **Yes.** | inputs R1 | step 5 |
| Q21 | A value equal to the declared default, not verified as the person's, is filed as `default` | **Yes.** | inputs R2 | step 3 |
| Q22 | In a composed run, a quote taken from that run's own message is filed as `composed-message` | **Yes.** | inputs R3 | step 5 |
| Q23 | `invalid-answer` and a bounded re-ask loop | **Yes.** | inputs R4 | step 4 |
| Q24 | `matched: 'spelling'` for an earlier answer given in another spelling (`24h` ↔ `-24h`) | **Yes.** | inputs R5 | step 5 |
| Q25 | The row fields `malformed` and `argumentsFrom` | **Yes.** | inputs R6 | step 5 |
| Q26 | `argumentResolutions`: one entry per call, carrying fills and refusals | **Yes.** | inputs R7 | step 3 |
| Q27 | `ToolPeriod` ships with step 3 (the consistency pass had already written this into the notes, because the architecture note contradicted itself) | **Yes — confirmed.** | inputs R8 | step 3 |
| Q28 | Answered values join the evidence gate's exempt corpus | **Yes.** | inputs R9 | step 4 |
| Q29 | The standings projection includes the current batch's own standings | **Yes.** | inputs R10 | step 5 |
| Q30 | `.inputsLayer()` covers ruled tools that only a ToolProvider serves | **Yes.** | inputs R11 | step 3 |
| Q31 | MCP ingest receives the tool's input schema | **Yes.** | inputs R12 | step 3 |
| Q32 | Route's dispatch test becomes one exported predicate | **Yes.** | inputs R13 | step 3 |

### From the results page ([results.md](results.md) § 10)

| # | Question | Adopted answer | Asked in | Lands in |
|---|---|---|---|---|
| Q33 | `held: 'unknown'` on a non-empty result | **It makes the answer "not sure" by default**, and bench cell R3's false-"not sure" rate decides. | results Q1 | step 7b; cell R3 |
| Q34 | `provenance` on `coverage()` as well | **No.** Only `absent()` and `describedResult()` get it. | results Q2 | step 7b |
| Q35 | The shorter, assembled note (7c) | **Ship it after an offline token count.** No hosted cell is needed. | results Q3 | step 7c |
| Q36 | Should the model see `describedResult()`'s `checked` list? | **Keep it in the record only until R4 shows a gain.** On a gain, serve it first only for `resultClass: 'inventory'`. | results Q4 | cell R4 |
| Q37 | The 7a draft on the local branch | **Review it as the rename PR once the notes are read.** Every row of the request's checklist was found in it ([results.md](results.md) § 6.1), but nothing was run. Before merging, run the full suite, the 21 byte references, the site budget and `docs:truth:report`. | results Q8 | step 7a — merged as #22 on its own track |
| Q38 | `coverage-undeclared` | **Yes, at step 8.** A tool that declares `resultClass` is held to it at run time. | results Q5 | step 8 |
| Q39 | `narrower-than-asked` (a tool that silently clamps its window) | **Not in v1.** It would bend "never parses '2h'". | results Q6 | — |
| Q40 | JSON-text envelopes from MCP clients in text mode | **For now, document `resultMode: 'structured'`.** Later, recognise them where tool results enter the loop, as a step of its own with byte references. | results Q7 | the docs now; a later step of its own |
| Q41 | The empty-data message | **Its own fix after 7a**, so 7a keeps "the same refusals". | results Q9 | step 7a′ |
| Q42 | A `clarify-open` reason | **Leave `clarify` as data only in v1.** Such a reason would over-report. | results Q10 | — |
| Q43 | The names: `period`, `queried`, `held`, `readAt`, `'unknown'`, the verdict words, the `period` row kind | **Keep the drafts.** | results Q11 | step 7b's docs |
