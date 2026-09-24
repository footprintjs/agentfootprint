# Honest answers from the record — decisions memo (2026-09-23)

**Status:** decisions, not design. For the owner and the builder, after three Fable review rounds
(the page's § 13–15) and three devil's-advocate reads of [the design page]
(./2026-09-honest-answer-ledger.md) — library-minimalist (devil 1), field and measurement (devil 2),
control-in-the-library (devil 3). The page is not rewritten here; section numbers are the page's.
Every fact below is `file · symbol` in agentfootprint 9.112.2 or the host (`host:` paths, commit
`05b7a2c`), or a row in the retained flagship record
`host:.dev/selection-arms-2026-09-23-1790173253876/events.ndjson` (196 rows) and
`host:docs/measurements/selection-arms-2026-09-23.json` (45 turns; `spent`: $5.306, 159 calls,
`cacheRead` = `cacheWrite` = 0), each re-read on 2026-09-23 for this memo. Nothing is built.
Nothing is committed. Costs are ESTIMATES derived from those two files and are labelled so.

**Update 2026-09-24:** this memo's § 7 records what the experiments taught, as written on
2026-09-23, and its § 8 records what shipped (9.113.0, 9.114.0), what the first before/after
showed, and why step 3 is on hold. Those two section numbers are this memo's own; everywhere
else a section number is the page's.

---

## 1. What the page settles, and what is still contested

The page settles the frame and it holds: an assessment is a fold over typed assertions with a
provenance, checked at the five moments that exist, acting only through the verbs that exist
(§ 3, § 5.4, § 10); the reason vocabulary reads existing rows (§ 5.3); `known` needs a SUPPORTING
row and the library says "consistent with the record", never "verified" (§ 5.6, R3-11);
`answerGuarantee: 'checked'` is a shape fact, never provenance (§ 5.1, F5/F9/F12); the harness has
four defects that make the 2026-09-23 run unable to answer the page's questions (§ 8.1); the
retained records hold zero `deny` rows and no recovery from one (§ 5.5); alias-006's seed holds one
cluster (§ 2); and step 3 is "one fold with three readers, one port, one context fact, one field
with its reader, one tier, two sentences, one event and the batch settlement", not one field
(§ 15). What is NOT settled is the SHAPE of step 3, and the three devils disagree with the page in
three directions at once: devil 1 says most of its library half exists already or is one host's
business logic (`ToolExecutionContext.tools?: ToolDispatch`, `src/core/tools.ts` line 729, omitted
by the page both times it lists the context's fields); devil 2 says that under the page's own
round-3 fence the flagship batch is `not-applicable`, so no armed shape changes Haiku's reply on
the case it was built for, and § 8 could not show a change if there were one; devil 3 says the
page's shape (A) leaves the decision to ask in app code, which is the owner's smell, and picks a
library-owned ask instead. Honestly: the enforcement core is agreed IN KIND (a declared rule the
library evaluates and records) but not in fence, not in where the placing role is declared, not
in who raises the ask, and nothing measured yet supports any armed hypothesis. § 3 decides the
shape; § 5 says what is spent before a line of step 3 is written.

---

## 2. SETTLED — build packets

### 2.0 Step 0 · the harness (app, $0 before any model call)

- **Files.** `host:scripts/bench/selection-arms.ts` · `runTurn` reads `reply.output` and
  `reply.reasoning?.ref` only (lines 167–169); a paused run answers `{ awaiting }` with HTTP 202
  and no `output` (`src/hosting/nodeHost.ts` header, line 11) and `host:be-server/reasoning.ts` ·
  `checkInReasoning` mints no ticket for it ("No recording means the run paused, threw, or the
  mint was refused", line 404) — so today a typed ask scores `recorded: false, reply: ''`, a miss.
  Change: read the 202 body and the per-server events log (H1: one sink per server), add a
  scripted responder with a declared answer per case. `host:scripts/bench/selection-observe.ts` ·
  `judgeTurn` / `asksUser`: H2 truth oracle from the seed; H3 "asked" hand-labelled in BOTH
  conditions plus a typed-ask column read from `pause.request.questionPayload.awaitingInput`;
  H4 Kalai scoring WITH raw counts beside it, a REGRET reference policy declared per case before
  any run, a lookup-before-ask column, blind double labelling with kappa reported.
  `host:scripts/bench/selection-questions.ts` lines 40–41 and the alias-006 `why` (line 118) still
  assert two clusters ending in 006; the seed holds one (§ 2) — corrected, and the case dropped
  from § 8.2's nine and § 8.3's budget (Q17).
- **Tests.** A dry-run test that a `requestInput` pause round-trips through `selection-arms.ts`
  and scores `asked: typed` with its recorded collectors.
- **README law + example** (bench README): "a paused turn is a recorded turn, never a miss", with
  the round-trip as the example.
- **Measure.** § 5 of this memo.

### 2.1 Step 1 · provenance and the ledger rule (library)

- **Files.** `src/integrity/assertion/types.ts`: the typed tier (`claimed | answered | given |
  observed | checked | judged`, § 5.1) with ONE writer — the wrapper carries the tier and RENDERS
  ContextFootprint's `provenance` string as `<tier>:<source>` (the convention the page's own
  example already uses, `'given:estate-naming-rule'`); never two provenance fields on one row
  (devil 1 #11 accepted in shape). The reader that earns the tier is the minimum-strength rule
  (§ 5.1). The key-strategy pin (Q10): the library's wrapper is the side on the legacy delimiter
  key (`assertionKey`, § 5.1, F8) — decide before any row from the host's copy is joined.
  `src/core/agent/findings/{types,ledger,serve}.ts`: a derived row kind `'unsettled-by-absence'`
  (name open) filed through `recordFindings` beside a `ruled-out` standing whose only witness is
  an `absent()` / declared-empty result, keyed to the standing's `toolCallId`, `settles` = the
  `tryInstead` STRING printed, never parsed; `serve.ts` quotes it under its own heading the way it
  quotes `contingent` (§ 5.6, R12).
- **Tests.** F3's HBA case: the model's `ruled-out` row byte-identical before and after; the 21
  references in `test/core/tools/reference/` unchanged.
- **README law + example** (findings README): "a standing whose only witness is an absence gets
  a row BESIDE it; the model's word is never rewritten", with the HBA example.
- **Measure.** None — type-level; the references are the measure.

### 2.2 Step 2 · the assessment — settled, with its SHAPE changed

The page stores one row on `AgentState` beside `answerGuarantee`, on the checkpoint, and emits
`answer.assessed` (§ 5.6). Devil 1 #6 and devil 2 #8 hold against that: canon Fold law 2 says "A
Fold is derived, never stored beside the Trace" (`docs/design/map-walker-trace-fold-lens.md`
lines 212–213); every step-2 reason is already a row; no reader inside the run branches on the
label (§ 5.5: "A label changes the ROW, never the reply"); on the host it can never say `known`
(§ 5.6); and over the retained arm-A records it would read `unrefuted` beside "No VMs are
currently hosted on SHPMAXPRDCL001" (vm-perf-on-array) and "not recognized as … host name"
(resolver-unknown). Decision: ship it FIRST as a pure exported reader in the
`src/ontology/score.ts` · `scoreAbsence` mould ("pure functions … Role: Lens, for a BENCH") —
`assessAnswer(recording)` (name open) over the § 9 step-2 reasons only (`value-unsupported`,
`value-survived-revision`, `value-contingent`, `sources-conflict`, `claim-contradicted`,
`lookup-empty` with the run count, `basis-stale`, `check-unreachable`, `expectation-missed`,
`tool-refused`, `value-unchecked` from the report and never `answerGuarantee`); the lens chip and
the `ProofMap` overlay read it at read time. The scope row, the event and the opt-in name (page
Q1/Q3) wait for a RUN-TIME reader (page Q4: who reads the row) — none is named today.

- **Files.** `src/integrity/assess/` (name open) + the lens. **Tests.** One unit per reason; the
  nine retained arm-A records as fixtures. **README law + example.** "The assessment is derived
  at read time; `known` needs a supporting row; the library says 'consistent with the run's
  record', never 'verified'" (§ 10 changes 4/5), with field-client-talk as the example.
  **Measure ($0).** The confusion table of the fold against the oracle over the nine retained
  arm-A records, published BEFORE anything else in step 2 is built.

### 2.3 Step 3 · the parts no reviewer contests

- **(i) Batch-sibling settlement on every resume path** — a pre-existing defect, not a design
  item. `src/core/agent/stages/toolCalls.ts` emits `iteration_end { toolCallCount: 1 }` on FOUR
  resume paths — the file's own law at its step-procedure boundary: "The batch loop and the four
  resume paths all finalize results" — the middleware-ask decision path, the check-in decision
  path, the credential-consent decision path and the `pauseHere` / `askHuman` path (their own
  section headers; lines 5039 / 5209 / 5344 / 5469 today; the main loop counts
  `toolCalls.length`, line 4734). The fourth is the one a typed ask resumes through:
  `core/pause.ts` · `requestInput` IS `pauseHere({ question, inputRequest })`, and the
  `pauseHere` path is "reached when none of the three decision pauses above claimed this
  resume" — so the settlement must land on all four, that one included (this memo's first draft
  counted three and omitted exactly it). The resume-side re-dispatch turns a `PauseRequest`
  raised while resuming into the result string "requested a pause while resuming an approved
  check-in, which is not supported" (line 3177). Siblings after a paused call are never
  dispatched, never bracketed, never counted, and the next request carries `tool_use` blocks
  with no `tool_result`. Fix: settle each un-dispatched sibling with the library's fixed
  past-anchored sentence, emit its `tool_start` / `tool_end` bracket, count it — on every one of
  the four paths. Q13 default: settle, never dispatch on resume (a resumed dispatch cannot
  pause: line 3177). Test: a three-call batch whose middle call raises `requestInput` — it
  resumes on the `pauseHere` / `askHuman` path, so that path is the one the test covers; the
  three decision paths get the same settlement, pinned. README law + example in the
  pause README. The host's own stopgap for one provider: `host:be-server/metricsProvider.ts` ·
  `createAnthropic({ parallelToolCalls: false })` (line 15).
- **(ii) The typed coverage vocabulary, first half.** `coverage/types.ts` ·
  `AbsenceDeclaration.tryInstead` gains the object form `{ tool, why? }` (the string stays),
  `notChecked[]` a `kind`, `events/payloads.ts` · `ToolAbsentPayload` carries `tryInstead`
  (§ 10 change 7, first half; devil 1's own verdict item 3). Additive. Test + README example on
  the flagship envelope (`try_instead: 'Widen the window, or check pscale_cluster_inventory …'`).
  *As shipped in 9.113.0 (a correction, so a producer and the second half read one key):* the
  object form rides its OWN key — `tryInsteadTool` on the declaration, `try_instead_tool` on the
  envelope, `ToolAbsentPayload.tryInsteadTool` on the event — and `tryInstead` / `try_instead`
  stay a string (a union there would break every reader typed against `ToolAbsence` in a minor).
  Wherever the page reads `tryInstead.tool` (§ 5.2, § 5.3 `source-not-consulted`, § 10 change 7,
  F15), read `tryInsteadTool.tool`. `notChecked[].kind` did not ship: no reader in the release
  reads it (coverage README, "Waiting for its reader").
- **(iii) A law for every library-composed correction, whichever shape ships.** Past-anchored,
  no named destination, registered in `test/modelFacingSurfaces.test.ts` (devil 1 #5 accepted).
  Rows: Lens law 2 (canon lines 257–259: "a present-tense or forward-looking clause is a
  prediction that outlives its own evidence"); `src/core/agent/selfCallNotice.ts` lines 30–38
  ("every clause is a fact about ONE already-finished event … anchored to that call by name");
  the 9.86.1 fix at `toolCalls.ts` line 4894 ("A past fact about the resumed call, not a forecast
  about the turn"). The page's sentences ("is unplaced", "Run it before any collector", "Run one
  of those first", § 5.5) fail the law and are rewritten before they are registered.
- **(iv) NOT settled although the page lists it:** the rewording of `evidence/gate.ts` ·
  `buildEvidenceCorrection` (line 330; § 10 change 7, second half). On the flagship the recheck
  never fired (`evidence_checked { posture: 'guard', unsupported: [], action: 'grounded' }`), so
  that sentence was never sent; held until a cell where it DID fire shows the
  absence-to-non-existence turn (devil 1 #12).
- **(v) A pausing lookup's observed absence is filed before the checkpoint** — a pre-existing
  generic defect, not a step-3 item, and outside § 5's gate (owner Q5). `stages/toolCalls.ts` ·
  `declareCoverage` (defined line 1357) runs only on a RETURNED result — its three call sites
  (lines 3053 / 3120 / 4032 today) all take the value the tool returned — and the batch loop's
  `isPauseRequest` catch (line 4090) returns the checkpoint's `pauseData` before any of them.
  So any app tool that throws `requestInput` from inside a lookup that found nothing leaves no
  `tools.absent` row, no `coverageDeclared`, nothing for the `CoverageBand`: the miss the person
  is being asked about is displaced from the record, and the APP cannot file it — the
  declaration's opaque `context` slot rides to the model on resume, never to the record; only
  the raise site can. Devil 1's verdict (deliverable 2) and the page's R3-9 agree it is real.
  Devil 3 #3's objection is to SHAPE — `coverage/absent.ts` · `readAbsence` reads only
  `af_absent === true` with a non-empty `checked` — and is answered by minting: the field
  carries the envelope `absent()` returns, so the one recognizer reads it unchanged. Fix,
  additive: (f) `InputRequestDeclaration.absence?` (name open) holding an `absent()`-minted
  envelope, added to `validateInputDeclaration`'s key allow-list (`['id', 'question', 'fields',
  'supplied', 'context']` today — the build constraint R3-P5 names); (g) the reader at the RAISE
  site: the batch loop's pause branch runs `readAbsence` → `declareCoverage` (and the
  `empty-lookup` seam when grounded) over it before `return`ing the checkpoint, so the rows are
  filed at the raise and nothing on resume reads the field — `inputRequest.ts` ·
  `readAwaitingInput`'s five-key re-validation gains no sixth key (devil 3 #7 stays moot). Not
  needed by C′ (§ 3: the lookups return their absences normally; the ask tool's raise carries
  none), and no host lookup reaches it today — its consumer is its own pinned test until one
  does. Test: a lookup raising `requestInput({ absence: absent(…) })` files byte-identical
  `tools.absent` + `coverageDeclared` rows to one returning `absent(…)`; the 21 references in
  `test/core/tools/reference/` unchanged. README law + example in the coverage README: "a
  lookup that pauses still declares what it looked at", with the raising lookup as the example.

---

## 3. CONTESTED — step 3's shape

| shape | what the library must know | holds it today? | change sites | collisions | cost | who owns control |
|---|---|---|---|---|---|---|
| **A** — the page's step 3: the placing lookup raises `requestInput` on a library `last-candidate` fact; a middleware FACTORY the app installs denies collectors | placements, placing role, argument kinds, this turn's calls AND batch order | history yes (`middleware/types.ts` · `ToolMiddlewareContext.history` — "Conversation so far, including the assistant turn that made this call"; the page's § 5.4 ask-doors row and § 15 header call it `ToolCallContext`, a symbol declared nowhere in `src/`, `test/` or `docs-next/`); declarations no; `ToolExecutionContext` has no history (`tools.ts` lines 681–729) | the page's nine items (§ 9 step 3 a–i) plus a host wrapper | `requestInput`'s own contract ("Collect declared fields using a dedicated tool. The query itself runs afterwards", `core/pause.ts` line 97; `inputRequest.ts` line 41 "inputs, not observations") — the root of R3-9's displaced miss; under the host's Python mode the binding's `execute` never runs (`host:src/pyBridge.ts` lines 171–173: `usePyTools() && composedOf === undefined ? pyCall : opts.execute`); (g) as the page writes it hands `declareCoverage` a declaration its one recognizer cannot read (`coverage/absent.ts` · `readAbsence` needs `af_absent === true` with a non-empty `checked` — answered in 2.3(v) by minting the envelope through `absent()` first); no row for the handed verdict; `Agent.ts` · `resume` builds `input_received` without the absence (line 2121); factory precedence — "The first non-allow answer wins" (`middleware/runChain.ts` line 18); the port is zero-arg (`core/agent/types.ts` line 77) → `AsyncLocalStorage` on this host (`host:be-server/viewerState.ts` line 833) | largest | the APP (its tool decides whether to raise and what to ask) |
| **B** — a declared rule the library evaluates per call in the per-call loop; prose ask | placements, placing role per (tool, argument), argument kinds, this turn's calls | history yes (the same `ToolMiddlewareContext.history`); declarations no | the pure fold; a built-in gate at `validateToolArgs`'s position (`toolCalls.ts` line 3677, after the middleware chain); a library-owned record row; the port; two declarations | permissive once every candidate lookup has missed unless an `exhausted` verdict exists (devil 3 #8); a prose reply places nothing (§ 5.1 minimum strength) so the gate denies again; no deny budget (the repeated-call nudge skips denied calls: `executed && !denied && !skillRejected`, line 4572) | fold + port + declarations + gate | the LIBRARY (the app declares) |
| **C′** — B plus a library-owned reserved ASK tool the model calls (`solo`; library-composed enum fields; question from a template key) | B's facts + the candidate kinds for the enum | as B; reserved-tool precedent exists (`buildToolRegistry.ts`: `present`, `skip_step`) | B + one framework tool + resume bookkeeping that writes the typed `answered` placement; the host declares the tool admissible in its cascade (`host:be-server/routing.ts` line 1023 denies non-collectors before a skill is selected) | `solo` is unbuilt (grep of `src/`: none) → 2.3(i) covers a batched call meanwhile; WHEN to ask is the model's (every honest ask on the record is prose; no uptake record); one extra iteration | B + one tool | the library enforces admissibility and fields; the MODEL asks |
| **C-lib** — B plus the library raising `requestInput` itself at the last declared miss, after the result | as B | as B | a post-result pause point, a raw-result carrier on the checkpoint, a resume branch composing the absence and the answer as ONE result, a `pauseDemandsDecision` arm; defined behaviour for every door that cannot pause (`toolDispatch.ts` header: inner calls "cannot pause") | the first library-raised pause AFTER a result (checkIn and consent both fire before `execute`); bends "the tool that asked is the tool that returns" | B + a pause shape | the library asks |
| **C-header** — the after-tool `ask` middleware arm the header invites | — | `ToolResultOutcome = AllowOutcome \| DenyOutcome` (`middleware/types.ts` line 157) | a new outcome member, a fifth resume path (page Q15) | hands every APP middleware a new control trigger — the smell, not the invited case (header lines 58–67) | — | app middleware |
| **D** — guide only | nothing | — | none in the library | the fold as app middleware over `ctx.history` ("a fact about the engine, not a documented contract", `docs/design/2026-09-declared-control.md` line 646), the raise in a wrapper, the absence in the opaque `context` slot, the answered placement by parsing strings — every item on the owner's smell list | 0 library | the APP |

**Recommendation: B built INTO the library as the enforcement core, C′ as the ask, the
multi-iteration order machinery NOT built — all of it gated on § 5.**

- *Enforcement (B, built in, never a factory).* A declared rule evaluated per call at
  `validateToolArgs`'s position (`toolCalls.ts` line 3677), verdicts `not-applicable | placed |
  pre-lookup | remaining | exhausted` — `exhausted` is new, because B as worded goes permissive in
  the one state where the collectors' zero-wrappers become "decommissioned" (devil 3 #8). A denied
  call lands as a library-owned record row with typed witnesses (name open; the page's
  `PlacementBecause` on `MiddlewareDecisionPayload` would make the middleware row carry a verdict
  the middleware did not evaluate) and reaches the model as a correction worded under 2.3(iii),
  with a refusal budget on the `noteSkillRefusal` precedent. The rule is stated per KIND over
  (tool, argument) bindings — `rvtools_get_vms` places by `vm`, `host` ("ESXi host name (FQDN or
  substring)") or `datacenter` (`host:tools-catalog.json`), and a miss under `host=` is evidence
  about an esxi-host, not a vm (devil 3 #20). Provider-served placing lookups are refused by name
  at build: `buildToolRegistry.ts` · `toolClaimants` ("Provider claims are not here — a
  `ToolProvider` resolves per iteration", lines 263–264). Not a factory: an app arm ahead of it in
  the chain pre-empts the verdict and no row is filed (`runChain.ts` line 18).
- *The ask (C′).* A reserved framework tool on the `present` / `skip_step` precedent, offered while
  the fold holds an unplaced subject, `solo` once capability 4 lands. Its `execute` runs the SAME
  fold: while lookups remain it refuses with a past-anchored correction; at `exhausted` it raises
  `requestInput` with library-composed fields (an `enum` over the candidate kinds ∪
  `'not-in-this-estate'`) and a question from a default template overridable by key — the
  precedent is `src/identity/consent.ts` · `consentQuestion` (line 81; consumed at `toolCalls.ts`
  line 3927): the library already words a person-facing question. Settlement is today's: the
  answer is the ask tool's own `InputResponseResult`, exactly as `pause.ts` line 97 documents. The
  lookups returned their absences normally, so every miss is already a `tools.absent` row and
  already in the model's history — nothing displaced; C′ itself needs no (f) `absence` field and
  no (g) reader (the generic gap those two name is a defect on its own, 2.3(v), not part of this
  shape), and no `ToolExecutionContext.placement`. The library's resume bookkeeping writes the
  typed `answered` placement; no string is parsed (devil 3 #5).
- *NOT built:* `last-candidate` / `remaining-lookups` counting over history and batch order,
  `ToolExecutionContext.placement`, the app-raised `requestInput` from inside a lookup as this
  design's ask (an app that raises it anyway gets its absence filed by 2.3(v) — a defect fix,
  not this shape). Devil 1 #1
  holds: `ToolExecutionContext.tools?: ToolDispatch` (`tools.ts` line 729, 9.76.0) with
  `Tool.composedOf` (line 289; `assertComposedOf`, line 1072) lets the app collapse its
  cross-estate lookups into ONE declared composed tool that knows "last" locally — a declared
  tool, not hand-written control — and it turns the page's "up to seven iterations before the ask"
  (§ 5.5, R3-P4) into about four. The page omits `tools?` both times it lists the context (§ 4
  ask-doors row; § 5.5).
- *Why not A, C-header, D.* A: control leaves the library (the tool decides whether to raise; no
  row for the handed verdict), the raise cannot live in the lookup under Python mode, and it uses
  `requestInput` against its contract. C-header: a new control trigger for app middleware.
  D: every rule becomes app code — the owner's whole smell list. Devil 1's own caveat concedes the
  point: "'the app declares, the library enforces' cuts against leaving the enforcement in the
  app".
- *The GATE.* Nothing in step 3 is built before § 5's $0 fence test and the replay probe pass.
  Devil 2 #1 stands as written: under § 15 R3-5's kind fence the flagship batch is
  `not-applicable` — the collectors' `cluster` slot is "cluster name or (any) fragment, e.g.
  '006'" (`host:tools-catalog.json` · `pscale_events`, `pscale_jobs`), so its honest kind is
  `name-fragment` (never counts) or `powerscale-cluster` (∉ {vm, esxi-host, storage-client}); the
  record: all three called with `{ cluster: 'SHQZXPLAP941' }`, `parallelCount: 3`, 0 `deny` /
  46 `allow`. And no record shows Haiku taking a named door after a correction (§ 4.2 #2). If the
  fence cannot fire on the flagship without a guess deciding, or the replay fails, step 3 waits;
  the deliverable is packets 2.0–2.2, 2.3(i)–(iii), 2.3(v) and a guide.

**What the owner must rule on** (default in brackets = what I take on "you decide"):

1. **Who starts the typed ask?** The model through the library's ask tool (C′ — the owner's
   literal "the LLM asks"; keeps "the tool that asked is the tool that returns"), or the library
   automatically at `exhausted` (C-lib — structural per § 7.3, deterministic; needs a post-result
   pause, a checkpoint carrier and a resume branch)? [C′; promote to C-lib if the typed-ask column
   is empty at n = 10.]
2. **The Map declaration — where does the placing role live, and what does the fence read?**
   (a) `src/ontology/README.md` · `sources[].via` already names the tools that read a term with
   the author's `coverage` sentence (lines 41–44), the host serves it unconditionally
   (`host:src/agent.ts` line 1404; the flagship record: `ontology.served { nodes: 44, sources:
   20, edges: 47 }` at every iteration) — so `resolves` on `defineTool` is a second owner (devil 1
   #3) and Q18's cut coverage clause already has a row. (b) The page's kind fence (`argumentKinds
   ∈ candidateKinds`, minted from an `identifier-shape` guess — `host:src/routing/subjects.ts`
   line 57: "a heuristic kind is a GUESS, so it never decides a verdict") is inert on the
   flagship; a ROLE fence (any tool without the placing role, keyed on the unplaced span, before a
   placing lookup for it ran) fires on the flagship and also on `app-sql-01` (shadow row:
   `status: 'unresolved', rule: 'SUBJECT_SHAPES.appHost … consumed opaque'`), i.e. on the two
   correct three-iteration turns field-vm-disks and array-backs-vm (arm A $0.104 each). [The
   ontology owns the role as a per-(tool, argument) binding; the fence reads the role, never
   `candidateKinds`; the host removes the app-sql-01 cost by DECLARING what an `app-…` name is,
   or pays one lookup.]
3. **Placements per run.** The page's port is zero-arg and agent-level (`ExternalGroundsProvider
   = () => readonly ExternalGround[]`, `core/agent/types.ts` line 77; "consulted once per LLM
   response", line 73), reaches per-request data on this host only through `AsyncLocalStorage`,
   and re-yields nothing on a resume ("Fresh executor", `Agent.ts` line 2142). Fed from
   capability 1 (`ExternalGroundsProvider(ctx?: { given })`, declared-control line 451) or
   `run({ placements })`? [Per run through capability 1 — it becomes a PREREQUISITE of step 3 and
   § 9's "NOT a prerequisite" is withdrawn; nothing about placements on scope (declared-control
   line 485).]
4. **May the library word a question shown to a person?** It does already (`consentQuestion`;
   `core/checkin.ts` · `shouldCheckIn` raises on the pure declaration `'always'`, lines 277–283),
   so the page's "the library composes no question of its own" (§ 5.5) is wrong on the code
   (devil 3 #18). [Yes — a default template overridable by key, registered in
   `test/modelFacingSurfaces.test.ts`.]
5. **Does the raise-site absence reader (2.3(v)) ship in this train, although no host lookup
   reaches it under C′?** Devil 1's verdict (deliverable 2) says build it — "a real generic gap,
   and the named field is earned by that reader"; devil 3 #3 dropped (f)/(g) as unnecessary for
   C′, which is true of C′ and not of the record: a lookup that pauses today leaves the miss it
   is asking about off the record, and only the raise site can file it. [Yes — a pre-existing
   defect with a library-only, additive, one-owner fix; outside § 5's gate; its consumer is its
   own pinned test until a lookup raises `requestInput`, and the memo says so rather than
   claiming a host path.]

---

## 4. DEVILS ANSWERED

### 4.1 Devil 1 — library-minimalist

| # | argument | verdict | what changes / the row |
|---|---|---|---|
| 1 | FATAL · step 3's library half only coordinates one host's lookup order; `ctx.tools` collapses it | ACCEPTED for the order machinery, REJECTED for the gate | `tools.ts` line 729 `tools?: ToolDispatch`; page omits it twice. (a)/(e) dropped, (d) becomes built-in; its own caveat: app enforcement holds "only if a second consumer shows the rule is generic" — the owner's rule says the library enforces what the app declares |
| 2 | SERIOUS · the pre-lookup deny is an app routing rule the host already writes as middleware | REJECTED on the rule, ACCEPTED on the evidence | "middleware that re-implements a rule" is the named smell; `host:be-server/routing.ts` lines 1023/1036 are skill-admission policy, not placement. No second consumer → the gate ships only behind § 5, and its record row is the library's |
| 3 | SERIOUS · `resolves` repeats the ontology's `via` | ACCEPTED | Q2 default: the role is a Map binding; Q18 closes on the served `coverage` sentence |
| 4 | SERIOUS · the `placements` port brings back ambient state and duplicates `given` | ACCEPTED | Q3 default; capability 1 restored as a prerequisite |
| 5 | SERIOUS · the two deny sentences break Lens law 2 | ACCEPTED | 2.3(iii); both rewritten past-anchored, destination-free; post-deny recovery keeps them honest |
| 6 | SERIOUS · the assessment row is a Fold stored beside the Trace; ship a pure scorer | ACCEPTED | 2.2: `assessAnswer(recording)` first; row + event only for a run-time reader |
| 7 | SERIOUS · `subject-unresolved` renders "no idea" on a correct answer (omit-never-deny) | ACCEPTED | `not-applicable` whenever a candidate lookup returned an undeclared shape — the deny arms' own rule (§ 5.5) — until declared hits exist on every measured lookup; § 8.2 reports it as the design's miss |
| 8 | SERIOUS · `candidateKinds` lets a shape guess decide denial and the ask | ACCEPTED | the fence never reads `candidateKinds` (Q2); the ask tool's enum may LIST them — an ask is not a verdict |
| 9 | SERIOUS · one host at n = 1; build the app arm first, lift later | PARTLY | the composed lookup and the harness ARE app-first (§ 5); the gate is not lifted from an app arm because the app cannot record a rule it did not declare; Q2's Map binding is the second-consumer test |
| 10 | SERIOUS · host-shaped vocabulary in generic types | ACCEPTED | no `PlacementBecause` on `MiddlewareDecisionPayload`, no `ToolExecutionContext.placement`, no reserved `'name-fragment'`; witnesses ride the gate's own row; kinds live on the Map |
| 11–14 | MINOR | 11 accepted in shape (one writer, 2.1); 12 accepted (2.3(iv)); 13 PARTLY — a read-only view of the turn's tool results on `AnswerValidationContext { signal, artifacts }` (`answer-validation/types.ts` lines 41–44) is the generic gap, but EXISTENCE / COVERAGE stay step-6 claim classes because `mode: 'observe'` records no reason the lens prints; 14 accepted — the host plan (Python lookups, catalog `_meta`, `Extras`, `SUBJECT_SHAPES`, the adapter) moves to the host repo | |
| verdict · deliverable 2 | "File a pausing tool's declared absence before the checkpoint (`InputRequestDeclaration.absence` plus `declareCoverage`). This is a real generic gap, and the named field is earned by that reader" | ACCEPTED — as a pre-existing generic defect, outside step 3 and outside § 5's gate; owner Q5 | 2.3(v): the field carries an `absent()`-minted envelope so `readAbsence` reads it (devil 3 #3's shape point answered); the reader runs at the raise site, so `readAwaitingInput` is untouched (devil 3 #7 stays moot); not needed by C′; devil 3 dissents on necessity, not on the defect; its only consumer today is its pinned test |

### 4.2 Devil 2 — field and measurement

| # | argument | verdict | what changes / the row |
|---|---|---|---|
| 1 | FATAL · the flagship is inert under the page's own fence | ACCEPTED as the first experiment | § 5 step 0a ($0); the kind fence is dropped by default (Q2) and a role fence tested beside it; if neither fires without a guess deciding, step 3 waits |
| 2 | SERIOUS · no recorded reaction to a correction was a move onto the named door; the deny names off-wire tools | ACCEPTED | re-verified in the measurements file: 0 of 45 turns ran `pscale_cluster_inventory` (four arm-A turns received the `try_instead` naming it); 30 `score_skills` calls, 10 refused (`routing.ts` lines 924/931); one turn with `readSkill.calls > 1` (D unknown-id-slow, 1 refused). The replay probe with a prompt-only control (§ 5); sentences name no destination (2.3(iii)); alias-006 A's first draft already asked → § 2's "A's ask came from the evidence gate" is corrected (§ 6) |
| 3 | SERIOUS · where the fence matches, it fires on correct easy turns | ACCEPTED into step 0a | field-vm-disks A $0.104 / 3 it., array-backs-vm A $0.104 / 3 it.; shadow: `app-sql-01` unresolved by `appHost`; Q2 names the host's two ways out |
| 4 | SERIOUS · the typed ask fires too seldom and too late | ACCEPTED in effect | C′ + the composed lookup reach the ask near iteration 4; reach probability is measured (§ 5, optional state), never assumed |
| 5 | SERIOUS · § 8 cannot separate the design from noise or a prompt change | ACCEPTED | n = 10 baseline, prompt-only control, blind double labels with kappa, lookup-before-ask column; ARMED unbundled (step-2 label, step-3 gate, step-4 kinds measured apart); wrong-domain is blind on unknown-id-slow by construction (`wrongDomain: []` for A/C/D) → an "unplaced subject keyed" column |
| 6 | SERIOUS · the harness scores a paused turn as a miss | ACCEPTED | 2.0, $0, before any model call |
| 7 | SERIOUS · Kalai scoring at n = 3 rewards giving up early | ACCEPTED | raw counts beside the score; REGRET's reference policy declared per case first; two labellers re-score the 45 rows; a premature ask is scored against the reference, not as 0 |
| 8 | SERIOUS · the assessment row points the wrong way on the retained record | ACCEPTED | 2.2: the $0 confusion table first; no scope row until a reader |
| 9 | SERIOUS · cost rises past the page's estimate | ACCEPTED | § 8.4's $0.13 = arm A + one call. From the record: $5.306 / 159 = $0.0334 per call; unknown-id-slow A $0.097 at 3 iterations → 7 iterations ≈ $0.23 + a two-iteration resumed leg ≈ $0.07 ≈ $0.30 per honest flagship turn before caching (`cacheRead` = `cacheWrite` = 0 on every call); with the composed lookup ≈ 4 iterations ≈ $0.13 + resume; arm E $0.048. Estimates |
| 10–11 | MINOR | accepted: the vm-perf truth oracle from the seed before step 4 is measured; the alias-006 corpus lines (2.0) | |

### 4.3 Devil 3 — control in the library

| # | argument | verdict | what changes / the row |
|---|---|---|---|
| 1 | FATAL · A leaves the decision to ask in app code; no row for the handed verdict; needs ambient state | ACCEPTED | A is not built |
| 2 | SERIOUS · the "one line" cannot live in the lookup under Python mode | ACCEPTED | `host:src/pyBridge.ts` lines 171–173 |
| 3 | SERIOUS · A misuses `requestInput`'s contract; (g)'s recognizer cannot read a declaration | ACCEPTED on the contract; ACCEPTED on the recognizer AS WRITTEN, not on dropping the reader | C′ uses the door as documented (`pause.ts` line 97); (f)/(g) dropped FROM STEP 3 — the generic gap they name ships on its own as 2.3(v), the recognizer point answered by minting through `absent()` (devil 1's deliverable 2 wants it built; the memo sides with devil 1 on the defect and with devil 3 on C′; owner Q5) |
| 4 | SERIOUS · on resume the model never reads the miss | ACCEPTED | under C′ every miss is an ordinary result in history |
| 5 | SERIOUS · `answered` has no typed carrier inside the chart | ACCEPTED | the ask tool's own resume bookkeeping writes the typed placement |
| 6 | SERIOUS · a factory leaves precedence to the app | ACCEPTED | built in at `validateToolArgs`'s position |
| 8 | SERIOUS · B as worded is permissive at all-miss | ACCEPTED | the `exhausted` verdict |
| 9 | SERIOUS · a prose ask cannot close the loop | ACCEPTED | the typed ask (C′) |
| 13 | SERIOUS · the header's arm is not the invited case | ACCEPTED | C-header rejected |
| 14 | SERIOUS · C-lib's settlement and its costs | RECORDED | the fallback's price, Q1 |
| 15 | SERIOUS · any in-batch pause needs the settlement, with brackets and counts | ACCEPTED | 2.3(i) |
| 16 | FATAL · D: the app writes every rule | ACCEPTED | D rejected |
| 18 | SERIOUS · the library already raises pauses from declarations (`checkIn`, consent) | ACCEPTED | Q4 default; the page's premise corrected (§ 6) |
| 19 | SERIOUS · the placements port breaks across a pause | ACCEPTED | Q3 default |
| 20 | SERIOUS · `resolves` must bind per (tool, argument), rule per kind | ACCEPTED | the fold's rule (§ 3) |
| 21 | SERIOUS · provider-served placing lookups are invisible to the fold | ACCEPTED | refused by name at build (`toolClaimants`) |
| 23 | SERIOUS · C′ leaves WHEN to the model; no uptake record | ACCEPTED as the risk Q1 measures | default C′, fallback C-lib |
| 7, 10, 11, 12, 17, 22, 24, 25 | MINOR | 7 live again with 2.3(v)'s field and answered there — the field is validated and READ at the raise site, nothing on resume reads it, so `inputRequest.ts` · `readAwaitingInput`'s five-key re-validation gains no sixth key and its `{ ...value, ...clean }` stays byte-identical; 10 `solo` unbuilt — the gate is per call, at `validateToolArgs`'s position; 11 anchor to "when that call was proposed"; 12 a refusal budget on the `noteSkillRefusal` precedent (line 4572); 17 = § 5; 22 per-turn counts read rows on scope (`Agent.ts` line 2153: "two runs, and each keeps its own ledger"); 24 the host declares the ask tool admissible (`routing.ts` line 1023) — a declaration; 25 registered text | |

---

## 5. MEASURE — the first experiment (Haiku 4.5 only; every dollar an ESTIMATE)

Rates from the record: 159 calls cost $5.306 at 5.03 M input + 55.7 k output tokens ≈ $1.05 per
million tokens blended; per call $0.0334 mean; per turn $0.118 mean, $0.104 median; arm A
unknown-id-slow $0.097 (3 iterations), resolver-unknown $0.118 (4); the flagship's per-call
input was 16,715 / 36,985 / 39,648 tokens at iterations 1–3 (`stream.llm_end`), no caching.

- **0a · The fence test — $0, no model call, FIRST.** Write `placementVerdict` as a test fixture
  (a pure function; not yet an export) and run it over the retained arm-A sequences (unknown-id-
  slow, resolver-unknown, field-vm-disks, array-backs-vm, vm-perf-on-array) and the harness rows'
  collector lists for the rest, under BOTH fences (the page's kind fence; the role fence of Q2),
  with the host stating the kinds its adapter would emit for `SHQZXPLAP941` and the declared kind
  of the collectors' `cluster` slot. Output: one table, (case, arm, call) → verdict. **Decides:**
  whether any before-tool shape touches the flagship batch without a guess deciding, and what the
  role fence costs on the correct three-iteration turns. Prediction on the record: kind fence →
  `not-applicable` on the flagship (devil 2 #1); role fence → `pre-lookup` on the flagship AND on
  `app-sql-01`.
- **0b · Harness fixes — $0, app.** Everything in 2.0. Plus: over the 45 recorded rows, count the
  turns that reach a before-tool moment keyed on an unplaced subject and the turns that reach
  every candidate lookup (devil 2's prediction: 0 and 0).
- **0c · Next-move replay — ≈ $1.6.** From the flagship's retained history at iteration 2
  (the `context.injected` rows plus the `iteration_end` history; 36,985 input tokens recorded):
  20 samples with the three collector results replaced by the gate's past-anchored correction;
  20 samples with the same sentence as ONE system-prompt line and no deny (prompt-only control).
  Classify each next move: a `read_skill` toward a placing lookup's skill or the lookup itself /
  a prose ask / a collector re-proposal / an answer. 40 calls × ≈ 37 k input ≈ 1.5 M tokens ≈
  $1.6. **Rule, declared before running:** at least 12 of 20 lookup-directed under the correction
  AND at least 8 more than the control (12/20 vs 4/20: two-sided Fisher exact ≈ 0.02,
  hypergeometric re-derived: mean 8, sd ≈ 1.6). If it fails, the correction's effect on the reply
  is not established and step 3 waits. Optional third state (+ ≈ $0.8): 20 samples from "the VM
  lookup returned an `af_absent` envelope, the host lookup has not run" — the reach probability
  of the typed ask is then P(steer after the correction) × P(next candidate after an absence).
- **0d · Unarmed baseline — ≈ $2.2.** Arm A, n = 10 each on unknown-id-slow ($0.097) and
  resolver-unknown ($0.118): base rates and spread, blind double labels, kappa. This replaces the
  page's n = 3 over nine cases (§ 8.3, ≈ $6.5); at n = 3 the most extreme split (0/3 vs 3/3)
  cannot clear 0.05 (two-sided Fisher exact 0.10).
- **Total ≈ $4.6, cap $10; a stopped run is reported as stopped, never as a rate.** What decides,
  in order: 0a says whether the gate CAN act on the flagship; 0c says whether Haiku MOVES on a
  correction (the number: lookup-directed next moves, corrected vs control); 0d gives the spread
  every later armed cell is judged against at n = 10. Only after all three pass does the host arm
  the composed lookup and the gate for a full-turn cell (≈ $0.30 per armed turn, estimate), and
  the typed-ask column decides Q1's promotion.

---

## 6. CORRECTIONS the owner should hear (one line each; § 12–15 of the page, plus this memo's)

- C1 (§ 12): "avoids the hop's collisions and bypasses nothing" — partly; a correction at the
  answer seam still needs a new Route branch and the stream held; the page makes the assessment
  a label and keeps corrections at the tool boundary.
- C2 (§ 12): "handed back before the answer goes out without discarding it" — true before a
  tool (`DenyOutcome`), wrong before the answer (message `deny` = `MessageDeniedError`;
  `.answerValidation()` withholds; `.claims()` records).
- C3 (§ 12): "five mechanisms, one form replaces them" — three share one substrate; two already
  ARE typed assertions over the record and neither corrects.
- C4 (§ 12): "the Data-panel button involves no model at all" — zero hosted calls, but the whole
  loop runs under a faked provider twice; what is missing is an app-authored turn on the record.
- F5/F9/F12 (§ 13): `answerGuarantee: 'checked'` means the output schema parsed the text — a
  shape fact; the receipt is a passed enforce `AnswerValidationReport`.
- F8 (§ 13): the ContextFootprint key claim was reversed — the LIBRARY's wrapper is on the
  legacy delimiter key; both copies ship the tuple default.
- F10 (§ 13): two "quotations" from the AWS Cedar post are not in it; Vercel's PDP input carries
  `messages`.
- R2/R13 (§ 14): alias-006's seed holds ONE `ps_cluster` ending in 006; the bench label and the
  page had copied the harness's `why` as fact.
- R9 (§ 14): AgentSpec has no `after_action` trigger.
- R10/R12 (§ 14): form 1 was a second owner of `requestInput`; the step-1 rule would have
  rewritten the MODEL's `standing`.
- R3-P1…P5 (§ 15): `resultKind` is on 82 of 90 catalog tools (an artifact-kind label);
  `af_absent()` has ~57 Python call sites, none in the case lookups; the TS mock's `absent()` is
  not the library's envelope; the flagship shape is multi-candidate; two build constraints gate
  every new declaration (the input-declaration key allow-list; `catalogTool`'s metadata law).
- New in this memo: § 2's "A's ask came from the evidence gate" on alias-006 is a misread (the
  iteration-1 draft already asked; the revision removed its examples). § 8.4's $0.13 is arm A
  plus one call; the page's own seven iterations cost ≈ $0.23 before the resumed leg. § 5.5's
  "the library composes no question of its own" is wrong on the code (`consentQuestion`;
  `checkIn: 'always'`). § 4 and § 5.5 list `ToolExecutionContext`'s fields without `tools?:
  ToolDispatch` (9.76.0), the door that collapses the lookup order. § 15 R3-5's kind fence makes
  the flagship batch `not-applicable` — the page's "the pre-lookup deny is reached on every
  recorded model-led sequence" (§ 5.5) does not survive the catalog's `cluster` slot text.
  § 5.4's ask-doors row and § 15's header cite `ToolCallContext.history`; no such symbol is
  declared in `src/`, `test/` or `docs-next/` — the before-tool context that carries `history`
  is `middleware/types.ts` · `ToolMiddlewareContext` (the fact is right, the holder's name is
  not). And this memo's own first draft: it counted three resume sites in `toolCalls.ts`; the
  file's law says four, and the omitted one — the `pauseHere` / `askHuman` path — is exactly
  the path a `requestInput` ask resumes through (2.3(i) corrected); it also recorded (f)/(g) as
  dropped outright, following devil 3, without telling the owner that devil 1's verdict wants
  the reader built (2.3(v), § 4.1, owner Q5 added).

---

## 7. What the experiments taught (2026-09-23; revised after the devil's review of the first draft)

**Status:** results, not design; nothing built, nothing committed. § 5 has run its $0 fence test (0a
with 0b's two counts) and THREE next-move replays (0c; a second single-factor run; a third on the
name-only ask tool); 0d has not run. Every number is a row in `fence/fence-table.md`,
`replay/RESULTS.md`, `replay/v2/RESULTS2.md` or — for replay 3, which has no results document yet —
`replay/v3/report3.rerun.log` (the frozen classifier's own report; the hand reading is not written).
Each replay's rule was registered before its first paid call (`RULE.md`, `RULE2.md`, `RULE3.md`) and
applied as written; hand readings sit beside the classifier's counts and never replace them (the first
draft broke this rule once — 7.2 #1 — and it is repaired). Library facts are `file · symbol` in
agentfootprint 9.112.2 (the version the host ran); host facts are `host:` at `0cebd55`. Dollars are
ESTIMATES at Haiku 4.5 list prices ($1/M input, $5/M output), metered per call in `spent.json` /
`spent2.json` / `spent3.json`.

**What this revision changes.** The review found two mechanisms the host's own code decides against
the first draft, and four conclusions the data do not carry. (1) On this host a PowerScale placing
lookup that finds nothing returns a DECLARED absence (`host:py-tools/server.py · _ps_absent_cluster` →
`af_absent`), so the ROLE fence HOLDS at `remaining` after the lookup Haiku actually takes; the draft
said it "would go quiet". The lookup that lifts the fence is the VMware one, whose miss is a bare
wrapper (`real_rvtools_get_vms`). (2) The three absence states (now four, with replay 3's S6) replay an
`rvtools_get_vms` result the host never returns — an AUTHORED `af_absent` envelope with authored
`not_checked` lines — so nothing measured after it is a finding about this host. (3) "B stays — the
enforcement core", (4) "the ask admitted whenever unplaced", (5) "keyed on fragments" and (6) "the
typed answer closes the flagship's failure" are each withdrawn or weakened in 7.2–7.3, with the
counter-case that undoes them. Every figure the review flagged is corrected in 7.1 and 7.2; the
arithmetic the review re-derived (spend, every Fisher value, the S1–S4 tallies) stands.

### 7.1 The numbers

| experiment | state (n) | counted | registered | beside (hand reading, sensitivity) | rule / note |
|---|---|---|---|---|---|
| 0a fence | flagship batch, unknown-id-slow A it. 2 (3 calls) | KIND-fence verdict | `not-applicable` ×3 | touches only if BOTH guesses are made (`powerscale-cluster` added to the SH… candidates AND the "any fragment" `cluster` slot read as `powerscale-cluster`) | devil 2 #1 confirmed: a guess would decide it |
| 0a fence | same 3 calls | ROLE-fence verdict | `pre-lookup` ×3 | reads the span, status `unresolved`, the recorded `cluster: 'SHQZXPLAP941'` and the role table — no kind, no heuristic; same under the strict table | 0a PASSES; 0c permitted |
| 0a fence | all 351 recorded calls (arm A live + discarded + dry, arm C dry) | verdicts n-a / placed / pre-lookup / remaining / exhausted | KIND 314 / 0 / 37 / 0 / 0 · ROLE 306 / 5 / 40 / 0 / 0 | strict ROLE 305 / 5 / 41 / 0 / 0; `kindAltArgKinds` 349 / 0 / 2 / 0 / 0 | `exhausted` 0 under every reading — structural on this host (7.2 #4), not a fact about Haiku |
| 0a fence | the 10 correct turns (field-vm-disks, array-backs-vm, arms A–E) | denies on a turn that is right today | ROLE 1 proven in the measured set (field-vm-disks A `rvtools_get_vm_disks { vm: 'app-sql-01' }`) + 4 conditional on unrecorded args; the discarded attempt's field-vm-disks A made the SAME call and is denied too (§ 3(b) last line, § 6.1) — **2 of 2 live runs** | strict 2 + 8; KIND 1 + 4 (the same cost — not specific to the role fence) | ≈ +$0.0439 per extra call ≈ +42 % of the $0.104 turn per iteration |
| 0b counts | 45 measured turns | turns reaching a before-tool moment keyed on an unplaced subject | KIND 1 + 4 · ROLE 2 + 6 · strict 3 + 10 | devil 2 predicted 0: holds for the flagship under KIND only | 36 of 45 turns judged from tool names alone (arms B–E; H1) |
| 0b counts | 45 measured turns | turns reaching every candidate lookup / reaching `exhausted` | 0 / 0 (KIND, ROLE); strict 0 + 1 / 0 | for SHQZXPLAP941 no KIND-candidate lookup ran in any turn; under ROLE `exhausted` needs a declared miss from all 18 bindings and the host's VMware/array lookups never declare one (§ 5.2) — the 0 holds by construction | devil 2's second 0 holds, for a structural reason |
| replay 1 | CONTROL (20) — the fact as the LAST line of the 48,360-char system prompt, directly under the map's "known, not held here:" line; no deny | next move | reproposal 20 · lookup 0 · ask 0 | #2: "I recognize `SHQZXPLAP941` as a PowerScale cluster name"; `_findings.basis` direct 20/20 | prompt-only control; one placement, not "a prompt line" in general |
| replay 1 | CORRECTION (20) — three past-anchored tool results | next move | **lookup 14 · prose-ask 4 · reproposal 2** | the 14: 13 `pscale_capacity { cluster: 'SHQZXPLAP941' }` + 1 `read_skill pscale-inventory`; the 2 registered reproposals call `pscale_inventory`, a tool that does not exist (by reading 16 existence checks toward the cluster, 0 re-proposals); `_findings.basis` exploratory 15/16 | PASS: 14 ≥ 12 ∧ 14 − 0 ≥ 8; Fisher p = 3.34 × 10⁻⁶. RULE.md's registered beside-reading: the pass is carried by lookups inside the PowerScale estate (candidate-kind lookups 0/20 vs 0/20, p = 1.0) — the estate split uses the page's candidate kinds (KIND-fence guesses; § 5.4 "the adapter is unbuilt") and DECIDES NOTHING (Q2) |
| replay 1 | AFTER-ABSENCE (20, descriptive) — CORRECTION + hand-built `read_skill esxi-inventory` + `rvtools_get_vms { vm }` → an **AUTHORED** `af_absent` envelope (the host returns a bare `{ total: 0, vms: [] }` here; 7.2 #5) | next move | prose-ask 13 · answer 5 · lookup 1 · wrong-lookup 1 | 18 asks by reading (4 imperative, 1 bold-question miss); "ESXi" named in 13/20 under the one rule used for every ESXi count here (`/\bESXi\b/` in text or `kinds`; the first draft's 17/18 came from `probe.mjs`'s any-`host` regex); `rvtools_get_host_details` 0/20 | descriptive; not a finding about this host |
| replay 2 | S1 neutral (20) — the correction minus its parameter name | next move | lookup-candidate 0 · lookup-powerscale 12 · role-open 1 · cluster-only 5 · other 2 | the 12: 9 `pscale_capacity` + 2 `pscale_topology` + 1 `read_skill pscale-inventory` (not the lookup); the 2 `other`s carry the fragment `'941'` (#1 the DENIED `pscale_op_latency`; #7 `pscale_capacity`, a placing binding); "cluster" written back 20/20; 6/6 asks state an absence the deny never said; `_findings.basis` exploratory 9/14 (vs CORRECTION 15/16, p = 0.0725) | R1 FAIL: role-open 1/20 < 6/20 (vs first CORRECTION re-read 2/20, p = 1.0) |
| replay 2 | S2 neutral + `ask_person` (20) | next move | typed-ask 20 · anything else 0 | kinds offered: `pscale_cluster` 20 (listed FIRST 20/20; the enum lists it sixth), `something-else` 19, `not-in-this-estate` 7, `esxi_host` 1, `array` 1; both escapes 6/20; `note` a yes/no PowerScale question 15/20; `_findings` on the ask 8/20 (direct 7, exploratory 1); placing lookups 0/20 vs S1 12/20 (p = 4.5 × 10⁻⁵) | viable (≥ 10); first move, no lookup before it |
| replay 2 | S3 authored absence + `ask_person` (20) | next move | typed-ask 5 · prose-ask-role-open 13 · lookup-powerscale 2 · lookup-candidate 0 | the 5 typed: role-open 5/5, candidate kinds 5/5, `vm` 5/5, `not-in-this-estate` 1/5, `_findings` 5/5 (direct 4, exploratory 1 — #20); "ESXi" 15/20; the 2 lookups are `read_skill pscale-triage` | partial (1–9); R2 FAIL as a conjunction; neither point EMPTY |
| replay 2 | S4 authored absence, neutral (20, descriptive) | next move | prose-ask-role-open 20 · tool calls 0 | `esxi_host` 18 by alias, "ESXi" 15/20 by the one rule, `vm` 18, cluster 18; `rvtools_get_host_details` 0/20; 4/20 tell the person to "use the pscale-triage skill" | R3 descriptive; vs first AFTER-ABSENCE role-open 20 vs 18, p = 0.4872 |
| replay 3 | S5 name-only `ask_person` at the correction (20) | next move | typed-ask 20 · anything else 0 | `name` exact 20/20; arguments beyond `{ name, _findings }` 0; `_findings` on the ask 20/20 (direct); the visible text names the cluster kind 19/20 and says verify / resolve / validate 20/20 | R4 PASS (≥ 10); vs S2 20/20, p = 1.0; classifier counts only — no RESULTS3.md |
| replay 3 | S6 name-only `ask_person` after the authored absence (20) | next move | prose-ask-role-open 13 · typed-ask 3 · lookup-candidate 1 · unserved-tool 1 · cluster-only 1 · answer 1 | #8 `rvtools_get_host_details { host: 'SHQZXPLAP941' }` — the first candidate-kind lookup in 180 samples; #4 `pscale_cluster_inventory` (unserved, `_findings` as a string); `_findings` on the 3 asks (direct 2, exploratory 1); any ask 17/20 | R5 FAIL (3 < 10); vs S3 5/20, p = 0.6948; S5 vs S6 20/20 vs 3/20, p = 2.57 × 10⁻⁸ |
| spend | replay 1 · replay 2 · replay 3 | calls, tokens, dollars | $2.4622 (60; 2,420,480 in / 8,344 out) · $3.4562 (80; 3,403,060 / 10,626) · $1.7399 (40; 1,719,180 / 4,135) | model `claude-haiku-4-5-20251001` 180/180; thinking blocks 0/180 (degraded, the record's own condition); cache 0; errors 0 | **$7.6582 of the $10 cap; $2.3418 left; 0d's registered reserve is $2.20, so $0.14 is uncommitted** |

Beside, never deciding: S2 vs S1 any ask 20/20 vs 6/20, p = 3.34 × 10⁻⁶ · S2 vs S3 typed uptake 20/20
vs 5/20, p = 7.71 × 10⁻⁷ · S3 vs the first AFTER-ABSENCE any ask 18/20 vs 18/20, p = 1.0 · S3 typed
asks candidate-open 5/5 vs S2 1/20, p = 1.13 × 10⁻⁴ · S1 vs CORRECTION moves inside PowerScale 14/20 vs
16/20, p = 0.7164 · S5 vs S1 any ask 20/20 vs 6/20, p = 3.34 × 10⁻⁶ · S6 vs S3 any ask 17/20 vs 18/20,
p = 1.0. Re-derived in `analyze.mjs` / `analyze2.mjs` / `report3.rerun.log`. All 180 samples are
draws from NINE byte-identical requests built from ONE history about ONE name: every p above measures
sampling noise inside that context, and a 0/20 carries a 95 % upper bound of 16.8 %.

### 7.2 What was learned (each item corrected where the first draft over-read)

1. **The deny changes the NEXT MOVE; no change in the END STATE is shown.** (Replaces "control at the
   tool boundary moves Haiku where a prompt line does not.") The same fact as the last system line:
   20/20 re-propose the denied collector. The fact as three plain tool results: registered lookup 14 ·
   prose-ask 4 · reproposal 2 (by reading, 16 existence checks toward the cluster, 2 of them to a
   tool that does not exist). That is a real difference in the next move. What it is NOT:
   (a) *An isolated channel effect.* CONTROL vs CORRECTION changes the refusal, the position (one line
   at the very end of a 48k-char prompt), the timing (before vs after the batch) and the repetition
   (one line vs three results) all at once; "the channel did the work — not the wording" is withdrawn.
   `_findings.basis`, which the draft used as the channel's evidence, moved again under a wording
   change that #2 says changed nothing (exploratory 15/16 → 9/14, p = 0.0725), so it is not clean
   evidence for anything. (b) *A better end state.* The unfenced arm A (`host:docs/measurements/
   selection-arms-2026-09-23.json`, unknown-id-slow) ended: "The cluster SHQZXPLAP941 is not in the
   collected estate … Next steps: Verify the exact cluster name…" — the bench scored it `asked: false,
   match: false`; `classify2`'s imperative rule reads the same text as a cluster-only prose ask. Either
   way it is the place the fenced prose asks end (CORRECTION: 2 cluster-only + 2 role-open under
   `classify2`; S1: 5 + 1), and the fenced asks are LESS grounded: 9 of 10 (CORRECTION 3/4, S1 6/6)
   state "not recognized in the collected inventory" when no lookup ran, while arm A's claim rested on
   three `af_absent` rows — the deny's own sentence read back as a negative finding, an
   omit-never-deny failure by proxy. (c) *The only lever tried.* Arm E — a subject-evidence prompt
   piece, no deny — asked "Which VM, ESXi host, or physical storage client it is" (match true, $0.048)
   while stating the resolver's heuristic as fact ("is cataloged as an application server"): a
   counterexample to "a prompt line does not", not an endorsement. The host's own `REFUSAL_NOTE`
   (`host:py-tools/server.py`: "says NOTHING about whether the thing exists … Do NOT report it as 'none
   found'") targets exactly the harm in (b); no library sentence with an absence guard was tried
   (`sentences.json`, `sentences2.json`). Cost side, proven: 2 of 2 live field-vm-disks A runs are
   denied on a turn that is correct today.
2. **The role lives in the model's own turn, the skill piece and the argument texts; neither wording
   tried removes it.** Taking `cluster ` out of the sentence (S1) changed nothing that matters: 14 vs
   16 moves inside PowerScale (p = 0.7164), 0/20 candidate kinds in both, the word back in all 20
   replies. Where it sits, on the record: the frozen assistant turn "Now I'll triage the cluster for
   slowness:" (`messages[3]`), the active skill piece ("WRONG SKILL? Pure inventory ->
   read_skill('pscale-inventory')"), every served slot ("cluster name or any fragment"). 6/6 S1 asks and
   3/4 CORRECTION asks convert "no lookup had placed" into an absence the record does not hold.
   2.3(iii) keeps the neutral form — it is the honest sentence — and step 3 counts on no wording to
   move the model. Claim limited to the two wordings tried in this one context.
3. **Fragments evade an exact-span fence — one sample, and the library already rules on it.** S1 #1
   re-proposes the DENIED collector as `pscale_op_latency { cluster: '941' }`. S1 #7,
   `pscale_capacity { cluster: '941' }`, is not a second case: `pscale_capacity.cluster` holds the
   placing role, so under a fence that read fragments it is a placing lookup and `not-applicable`
   (`fence.ts · verdictFor`, the placing branch), and under the exact-span fence it is not keyed at all.
   The evidence is 1 of 140. `'941'` is three characters; the library's grounding checks never read a
   value under four (`src/integrity/argumentLeaves.ts · MIN_CHECKED_LENGTH = 4`;
   `unsupported-argument/check.ts`: "VALUES UNDER FOUR CHARACTERS ARE NEVER CHECKED … noise in both
   directions") — a floor armed by `Tool.argumentsFrom` (`core/tools.ts`), which the host already
   declares for `rvtools_get_vm_disks → rvtools_get_vms` (`host:py-tools/tool_metadata.py`). A fence
   that read `'941'` as `SHQZXPLAP941` would be a second owner of that threshold, would read catalog
   prose ("any fragment, e.g. '006'") for want of a typed declaration (§ 5.2: the host declares none),
   and would let a guess decide a deny — the property on which 0a rejected the KIND fence. The
   catalog's own example, `'006'`, is three characters too: both stay out of reach. The first draft's
   change (a) is WITHDRAWN as a change from the data (7.3).
4. **In the flagship context Haiku walks to a candidate-kind lookup 1 time in 180; on the live record
   it does walk for app-sql-01; and `exhausted` is unreachable on this host by construction.**
   (Replaces "the model never walks to a candidate lookup".) In the flagship context: 0/140 across
   replays 1–2 (the v1 classifier's one right-estate credit, AFTER-ABSENCE #17 `read_skill
   pscale-triage`, is a return to PowerScale by reading and `lookup-powerscale` under `classify2`), then
   replay 3 S6 #8 `rvtools_get_host_details { host: 'SHQZXPLAP941' }`. `pscale_client_activity
   { client }` "taken 0/80" says little: its `cluster` argument is REQUIRED in the served schema, so it
   cannot place an unknown client. On the live record the model takes candidate-kind placing lookups:
   array-backs-vm A `vm_storage_map { vm_name: 'app-sql-01' }` and field-vm-disks E `rvtools_get_vms`
   (arguments not recorded) (§ 6.1, § 3(b)). `exhausted` under ROLE needs a declared miss from all 18
   bindings across every estate (§ 3(d)); the host's VMware and array lookups never return one
   (`real_rvtools_get_vms` `{ total: 0, vms: [] }`, `real_vm_storage_map` `{ disks: 0, note }`,
   `real_rvtools_get_host_details` `{ count: 0, hosts: [] }`, `real_pmax_get_inventory` `{ count: 0 }`),
   and under § 4.1 #7 the first undeclared return makes the verdict `not-applicable` — so 0b's "0
   reach `exhausted`" is a fact about the ROLE fence's 18-binding candidate set and the host's
   declarations, not about Haiku, and it does not corroborate the replays. Design consequence, not
   decided here: a DECLARED, narrower candidate set for a span shape (a host declaration on the
   resolver rule — page § 9 step 3 app half — read as a declared predicate, never a heuristic guess)
   is what would make `exhausted` reachable and keep a "lookups first" guard; Q2 forbids the fence
   reading a GUESSED kind, not a declared one. The memo's reach bound, P(steer after the correction) ×
   P(next candidate after an absence), measures 0/20 × 1/60 in one context — and the second factor
   was measured after an AUTHORED absence (#5).
5. **Four states replay a result this host never returns.** AFTER-ABSENCE `messages[8]`, inherited by
   S3, S4 and S6, is a hand-built `rvtools_get_vms` result: `{ af_absent: true, … not_checked: [{ what:
   'whether such a machine exists at all', why: 'this reads the RVTools VM export, not the estate' },
   { what: 'VMs created since the periodic export', … }] }` plus the library's `ABSENCE_NOTE`
   ("reaching that needs a different question, not a retry"). `host:py-tools/server.py ·
   real_rvtools_get_vms` never calls `af_absent`; a miss is `{ query, sorted_by, total: 0, returned: 0,
   vms: [] }`, and the live record agrees (vm-perf-on-array A, § 6.1: "bare wrapper … total=0").
   Memo § 5 0c's optional third state asked for exactly this envelope and the ledger page's own row
   already said the host does not mint it there — the memo's premise, not the host's shape; the first
   draft's caveat said only "hand-built". The `not_checked` lines are authored text that opens the
   role ("such a MACHINE") and steers toward asking. The absence Haiku would reach on its OWN path
   (registered 12–14/20 PowerScale lookups, 13–16 by reading; never executed in the replay) is
   `_ps_absent_cluster`'s: `checked` "the collected PowerScale
   measurements … for a cluster tag matching "SHQZXPLAP941"", `not_checked` "whether such a CLUSTER
   exists at all", `try_instead` "Known collected clusters: … Pass any fragment of one — "006" is
   enough" — text that keeps the cluster reading and invites the fragment — and it was never replayed.
   (It also interpolates the caller's argument into `checked`, which `af_absent`'s own docstring
   forbids because an echoed identifier grounds an invention; a host fact to carry into that replay.)
   Consequences: "after one absence the walk ends in prose", S3's and S6's uptake, and the first
   draft's "Q3 … now needed on the path most turns take" are findings about a host whose VM lookup
   declares its misses. On THIS host a VM miss is undeclared, the verdict is `not-applicable` and the
   collectors RUN — there is no deny-again loop after a prose ask today. WITHDRAWN: "the path most
   turns take". Needed before any conclusion rests on an absence: (a) the real post-correction state —
   CORRECTION + `pscale_capacity { cluster: 'SHQZXPLAP941' }` + the host's real `_ps_absent_cluster`
   envelope, the collectors still denied at `remaining`; (b) a VM miss returning the host's real bare
   wrapper. Both unfunded (7.4).
6. **The typed ask is taken at the correction — with the model's choices and with the library's —
   and carries the guess either way.** S2 20/20 (model kinds: `pscale_cluster` first 20/20, the only
   map term 19/20); S5 20/20 (name only: the visible text still says verify / resolve "the cluster
   name" 20/20 and names the cluster kind 19/20). After the authored absence: S3 5/20, S6 3/20
   (p = 0.69) — and S3's model-chosen kinds were open 5/5. `not-in-this-estate` was OFFERED in 7/20
   (S2), both escapes in 6/20 — reported as offers, not as "the true answer": the record does not hold
   whether SHQZXPLAP941 is in the estate (the authored lookup read one export, "not the estate"; the
   case label says "resolve or clarify, never invent its type", `host:scripts/bench/
   selection-questions.ts`; the host's resolver reads the name as "an application server", § 5.4, for
   which an unmonitored machine's honest answer is `something-else`, offered 19/20). Confound
   unchanged: the ask tool's first sentence is the correction's own ("for a name that no lookup in
   this turn has placed"), kept byte for byte in v3 (RULE3, choice 2); the echo control has no funded
   run (7.4). `_findings` rides the ask call (S2 8/20, direct 7; S3 5/5, direct 4; S5 20/20, direct;
   S6 3/3) — the ask filed as evidence; 7.3 says what to do about it.
7. **The fence holds against the path Haiku takes and lifts on the one it does not.** (Replaces the
   first draft's #6, which had the mechanism backwards.) `_ps_absent_cluster` returns `af_absent` with a
   non-empty `checked` — the fixture's own declared-miss recognizer (`fence/load.ts · classifyResult`,
   a copy of `coverage/absent.ts · readAbsence`) — so after the 13 `pscale_capacity` and 2
   `pscale_topology` calls the ROLE verdict on the collectors is `remaining` (17 of 18 bindings not yet
   run, § 3(d)): a DENY, not silence. The fence lifts only after an UNDECLARED return, and on this host
   that is the VMware/array path: `rvtools_get_vms`, `vm_storage_map`, `rvtools_get_host_details`,
   `pmax_get_inventory` return bare wrappers on hit and miss alike (§ 5.2; § 4.1 #7). So a walk that
   stays in PowerScale is held; a walk that checks VMware — the check the case wants — lifts the fence
   whatever it finds. That is the inverse of the flagship's need, and it is a fact about the host's
   declarations, not about the fence. DROPPED: "the deny would have bought one wrong-estate lookup and
   nothing", and "intent not met" (7.5). The one live turn that ran `pscale_capacity` on the flagship
   (arm C, order not recorded) ended "not present in the collected PowerScale inventory". Unchanged
   from 0a: the resolver emits no span for `epic-cache-07`, so no fence touches resolver-unknown.
8. **A placement of ANY kind unlocks every collector keyed on the span, so the typed answer enforces
   nothing on the flagship.** `fence.ts · verdictFor`: a resolved subject with a keyed argument, or an
   earlier declared hit naming the span, returns `placed` with no kind read (Q2 rules it so). § 3(c)
   shows it on the record: `rvtools_get_vms { host: 'SHPMAXPRDCL001' }`, a category error, is `placed`
   under ROLE. Step 4's `argument-kind-mismatch` cannot catch the flagship's collectors: every
   `pscale_*` `cluster` slot is declared `name-fragment` (§ 5.3), "the one kind that NEVER mismatches"
   (`af:docs/design/2026-09-honest-answer-ledger.md`, the argument-kinds row). So once a person
   answers `vm` (C′'s resume bookkeeping) or a prose answer is declared through capability 1 (Q3),
   both fences admit `pscale_op_latency { cluster: 'SHQZXPLAP941' }` — and the cluster role persists
   in the model's turn (#2): S3 #2/#19 and S4 4/20 point back to pscale-triage after a VM miss. B + C′
   as drafted enforce "a placement exists", never "this collector fits the placed kind".
9. **Admitting the ask at the correction is predicted to turn app-sql-01's correct turns into a
   person interruption.** S1 → S2 is single-factor (the ask tool added): placing lookups went 12/20 →
   0/20 (p = 4.5 × 10⁻⁵) and the ask was the first move in 20/20, no lookup before it. field-vm-disks
   A's first collector, `rvtools_get_vm_disks { vm: 'app-sql-01' }`, is denied under ROLE in 2 of 2
   live runs (§ 3(b)); the placing lookup the deny asks for (`rvtools_get_vms.vm`, slot text "e.g.
   app-sql-01 — look it up") HITs (array-backs-vm A, `vm_storage_map`) — memo Q2's cost line, "or pays
   one lookup", is the host's recovery today. With `ask_person` admitted at that deny, the correction
   sentence and the tool description repeat the words S2 saw, and S2's evidence predicts an ask
   instead of the lookup: a pause, a person's answer and a resumed leg (≈ $0.30 per armed turn, memo
   § 5) in place of one ≈ $0.044 call, on a turn that is right today. Not measured — the state never
   ran; the memo's C′ refusal "while lookups remain" was the guard against exactly this, and the first
   draft dropped it on the flagship's evidence alone.

### 7.3 The revised step-3 shape — what the data now support

- **B stays GATED — not "the enforcement core".** The mechanism is unchanged (a declared rule the
  library evaluates per call at `validateToolArgs`'s position, `stages/toolCalls.ts`; never a factory,
  `middleware/runChain.ts` "The first non-allow answer wins"; verdicts `not-applicable | placed |
  pre-lookup | remaining | exhausted`; the role a per-(tool, argument) binding, Q2; a library-owned
  record row; the correction worded under 2.3(iii); a refusal budget on the `noteSkillRefusal`
  precedent). What the data show for it: the deny changes the next move; no end-state gain over the
  unfenced arm A is shown; its absence claims are less grounded than arm A's; it costs 2 of 2 live
  field-vm-disks A runs a deny on a correct turn (#1). Before a per-call deny is committed, two
  cheaper levers are tested against arm A's recorded reply as the comparison: an ABSENCE GUARD in the
  correction sentence (a fact about the deny itself — "nothing was queried, so this result says
  nothing about whether the name exists" — passes 2.3(iii): past fact, no destination, no imperative;
  the host's `REFUSAL_NOTE` is the precedent for the content, minus its "Do NOT" / "Supply" imperatives,
  which the law forbids), and a
  SUBJECT-EVIDENCE arm (arm E's piece, no deny; its "cataloged as" overstatement fixed). Every state,
  fenced or not, is compared against arm A's end state, not against CONTROL's next move.
- **(a) Keyed on fragments — WITHDRAWN as a change from the data (#3).** One sample; the threshold is
  owned by `argumentLeaves.ts · MIN_CHECKED_LENGTH`; `'941'` and `'006'` are under it; a fragment match
  is a guess deciding a deny. If a fragment fence is ever wanted it needs a typed declaration (name
  open) on the binding, its owner named as that threshold, and it stays outside this train.
- **(b) Lifted only by a placing HIT — changes nothing today (#7).** A declared miss already holds the
  fence at `remaining`; an undeclared return lifts it under § 4.1 #7 whether it was a hit or a miss;
  (b) would bite only on a host that declares hits (0 here, § 5.2). The running rule on this host is
  § 4.1 #7, and the memo says so instead of claiming the fence holds. The design fact to carry:
  declared misses on the PowerScale path plus undeclared everything on the VMware/array path make the
  fence hold where the walk is wrong and lift where it is right; the host half (declaring hits AND
  misses on the VMware lookups) is what would turn that around.
- **C′ — admission stays BEHIND a lookup, pending one replay (#9).** Not "admitted whenever the fold
  holds an unplaced subject". The rule the data support until the field-vm-disks replay runs: the
  ask tool's `execute` refuses at `pre-lookup` (no placing lookup for the span has been tried this
  turn) and admits at `remaining` (at least one declared placing lookup tried, whatever its estate),
  raising `requestInput` with the fold's own facts — which placing lookups ran, what they covered —
  as the lead line and the record row. Under it S2/S5's 20 asks are refused (no lookup had run) and
  S3/S6's are admitted (one had). It keeps app-sql-01's one-lookup recovery and admits the ask on the
  path the model takes on its own (registered 12–14/20 take a PowerScale placing lookup, 13–16 by
  reading, whose real result on this host would be a declared miss, #7). Unmeasured: what Haiku does
  after a refused ask, and what it does at `remaining` (7.4, replay (a)). The replay that decides: the field-vm-disks deny state with `ask_person`
  served, lookups counted against asks (≈ $0.9 at n = 20; unfunded, 7.4). Q2's cost line becomes
  "pays one lookup — or, if the ask were admitted before it, a pause". Settlement unchanged: the
  answer is the ask tool's own `InputResponseResult` (`core/pause.ts · requestInput`); resume
  bookkeeping writes the typed `answered` placement; 2.3(i) settles a batched sibling.
- **Choices — the data support the smaller change, not a library list of all eleven.** Both escapes
  always present (S2 offered `not-in-this-estate` 7/20, both 6/20); the served map order; no model
  `note` (the leak, #6); the model's own kinds RECORDED and shown as a narrowing the person can widen
  (S3's were open 5/5; S2's were the guess) rather than discarded. A composed list of all eleven is not
  required by any number here and reads as noise for the person: RULE3's illustration offers "one FC
  interface on a switch (fc1/5)" and "a Cisco MDS 9710 director" — a set the catalog declares closed
  (§ 5.1, "the estate has those eight and no others") — and nothing that matches the resolver's own
  reading, "an application server". What each escape WRITES is unspecified and must be before build;
  proposal, not ruled: `something-else` leaves the subject unplaced (no collector unlocked) and files
  the person's text as an `answered` row; `not-in-this-estate` writes an `answered` placement that
  keeps every collector keyed on the span denied and gives the model a claim with the person as its
  witness. Replay 3's contribution: the name-only door costs no uptake at the correction (20/20) and
  none distinguishable after the absence (3/20 vs 5/20); no person has answered any of it.
- **The typed answer must BIND, or the door buys nothing on the flagship (#8).** A new owner ruling,
  Q6: either (i) a collector keyed on a span placed as kind K is admitted only when its binding's
  declared kind is K or is declared kind-agnostic — which needs `argumentKinds` declared on the
  collectors (the host declares none today, § 5.2) and reads a kind the person ANSWERED or a declared
  lookup OBSERVED, never a `candidateKinds` guess (Q2's objection was to guesses); or (ii) the claim
  that the typed answer closes the flagship's failure is dropped, and the ask buys a typed, dated
  `answered` row only. [Default: (i); under (ii) `pscale_op_latency { cluster: 'SHQZXPLAP941' }` is
  admitted after the person said "vm".]
- **`_findings` on the ask tool.** Either the reserved ask tool is exempt from `findings/reserved.ts ·
  withFindingsArgument` — the served `present` entry carries it too, so this is a choice about
  framework tools, not a one-off — or the ledger states how it files a finding that rides an ask (it
  witnesses no evidence; the answer arrives on resume). [Default: exempt; a `basis: 'direct'` row on a
  question is a row about nothing. 36 of 48 typed asks across S2/S3/S5/S6 carried one.]
- **Q3 — a prerequisite for the resume path, not "the majority path" (#5).** A prose answer places
  nothing (§ 5.1 minimum strength), so the resume path still needs capability 1's `given` door
  (`ExternalGroundsProvider` gaining `(ctx?: { readonly given?: unknown })`, `docs/design/
  2026-09-declared-control.md` § Capability 1). The widening to the prose-ask majority rested on the
  authored absence; on this host a VM miss lifts the fence and the collectors run, so no deny-again
  loop follows a prose ask today. The host's cascade admission of the ask tool (`host:be-server/
  routing.ts`) is unchanged.
- **The composed `execute` — INFEASIBLE on this host; struck as an option until the declarations
  exist.** Under ROLE `remaining` can mean up to 17 lookups across every estate per ask; the host
  declares no hits; `rvtools_get_vms` returns a bare wrapper; the array tools answer a miss with "a
  question naming the real candidates" (§ 5.1) — the first undeclared return makes the verdict
  `not-applicable` (§ 4.1 #7), so a composed lookup can neither place the name nor reach `exhausted`.
  It also needs the remaining set that the "NOT built" list below rules out. The Python-mode
  constraint the first draft cited (`host:src/pyBridge.ts`, `composedOf` keeping a host tool's own
  `execute`) governs host catalog tools, not a library reserved tool. If ever built: cost bounded by
  ≤ 17 tool calls per ask under ROLE, no extra model iteration.
- **NOT built, unchanged:** `last-candidate` / `remaining-lookups` counting over history and batch
  order; `ToolExecutionContext.placement`; the app-raised `requestInput` from inside a lookup as this
  design's ask; `PlacementBecause` on `MiddlewareDecisionPayload` (`events/payloads.ts`).

### 7.4 Still open, and what would settle it

- **Replay 3 — RAN** (correcting the first draft's "in flight, nothing on disk"). `replay/v3/RULE3.md`
  registered S5 (name-only ask at the correction) and S6 (name-only ask after the authored absence)
  before its first call; 40/40 samples, $1.7399, errors 0; R4 PASS (S5 20/20), R5 FAIL (S6 3/20). The
  frozen classifier's report (`report3.rerun.log`) is the source of every replay-3 number here; the
  hand reading (a RESULTS3.md) is not written, and nothing in 7.3 rests on replay 3 beyond the two
  registered outcomes and S6 #8. RULE3 has NO echo-control state: it keeps the v2 first sentence byte
  for byte and says so ("It stays confounded here exactly as in v2").
- **The vocabulary echo (S2 vs S3, S5 vs S6) has NO FUNDED RUN.** The single-factor control RESULTS2
  § 5 named (the absence state with the placement line re-stated in the correction's vocabulary,
  ≈ 20 × 46k tokens ≈ $0.93) cannot run: $2.3418 is left and 0d's registered reserve is $2.20. Owner:
  drop a cell (0d at n = 5, or the echo control) or raise the cap.
- **0d, the unarmed baseline (≈ $2.2; n = 10 on unknown-id-slow and resolver-unknown, blind double
  labels, kappa) — not run.** Every later armed cell is judged against it; $2.20 of the $2.34 left is
  reserved for it; a stopped run is reported as stopped.
- **The two replays #5 needs — unfunded:** (a) the real post-correction state (CORRECTION +
  `pscale_capacity` + the host's real `_ps_absent_cluster` envelope, collectors at `remaining`;
  ≈ 20 × 39k ≈ $0.8); (b) a VM miss returning the host's real bare wrapper (≈ $0.93). Until (a) runs,
  nothing here says what Haiku does at `remaining` — the state its own path reaches.
- **The field-vm-disks ask replay (#9) — unfunded:** the deny state with `ask_person` served, ≈ $0.9
  at n = 20, lookups counted against asks. It decides C′'s admission rule.
- **The fence's cost on correct turns** rests on 2 of 2 live denies + 4 conditional: call-level
  arguments for arms B–E (H1, one events sink per server — harness 2.0) settle the 4.
- **The fragment rule — closed as a data item (#3); open only as a declaration question** (a typed
  fragment declaration on a binding, owner `MIN_CHECKED_LENGTH`), outside this train.
- **Nothing measures the fold's refusal, the resume or the person's answer** — the ask tool was never
  executed in any replay (`RULE2.md`, `RULE3.md` "Not exercised"). The first full-turn cell needs
  harness 2.0 first (a paused turn scores `asked: typed`, never a miss), then ≈ $0.30 per armed turn.
- **Whether the returns to PowerScale after an absence** (first run 2/20; S3 2/20; S4 0/20; S6 1/20,
  unserved) are wording or noise is not distinguishable at n = 20.
- **The resolver gap** (`epic-cache-07` gets no span) is host work; no fence reaches it.
- **The host's `.dev` directories:** seven postdate the fence set's last one (…1790192059993):
  …1790193992189, …1790194027772, …1790194190190, …1790197979131, …1790199307624, …1790201848575,
  …1790204821627. All are scripted (`model: "mock"`): 2,530 event rows each (…1790194027772: 165), of
  which 62 (4) carry the mock model, 0 carry Haiku. No live 0d or replay trace exists in the host.
  (The first draft named three and said "62 rows each".)

### 7.5 Owner rulings this changes

None of Q1–Q5 flips by its own rule; one ruling is new. What each carries, with the conditions THIS
AUTHOR added labelled as such:

- **Q1 (C′; promote to C-lib if the typed-ask column is EMPTY at n = 10):** Q1's own rule — the
  typed-ask column of a FULL-TURN cell at n = 10 (memo § 5, last paragraph) — has NOT been evaluated;
  RULE2's R2 and RULE3's R4/R5 are next-move proxies this author substituted. Under the proxies no
  offer point is EMPTY (S2 20, S3 5, S5 20, S6 3), so nothing here promotes C-lib. Stays C′, with the
  admission rule of 7.3 (refuse at `pre-lookup`, admit at `remaining`) until the field-vm-disks replay
  says otherwise; C-lib's own trigger, `exhausted`, is unreachable on this host by construction (#4),
  and the composed `execute` is not a fallback (7.3).
- **Q2 (the Map owns the role; the fence reads the role, never `candidateKinds`):** stays. The first
  draft's "keyed on span + fragments" is withdrawn; "lifted only by a declared HIT" is moot on this
  host; § 4.1 #7 is the running rule. The pre-lookup sentence still cannot name "the lookups for what
  it could be" without a kind — and in this context no sentence tried moved the model to a candidate
  lookup (1/180). New question carried to Q6: whether an ANSWERED or OBSERVED kind binds the
  collectors (#8) — a declared kind, not a guess, so not what Q2 ruled against.
- **Q3 (placements per run through capability 1):** stays a prerequisite for the resume path; the
  "majority path" widening is withdrawn (#5).
- **Q4 (the library words the question):** stays yes, narrowed — the library adds the escapes, fixes
  the order and drops the note; it does not replace the model's kinds with a list of all eleven (7.3).
- **Q5 (2.3(v), the raise-site absence reader):** untouched — no sample raised `requestInput` from a
  lookup. Ships as ruled, outside the gate.
- **Q6 (new): does the typed answer BIND the collectors to the answered kind?** [Default: yes, (i) in
  7.3.] Without it B + C′ admit the flagship's wrong-domain collectors the moment any placement exists.
- **The GATE (§ 3 / § 5):** the registered 0c rule is "lookup-directed" (memo § 5) and it PASSED
  (14 ≥ 12, 14 − 0 ≥ 8). The estate split is RULE.md's registered BESIDE-reading ("a pass carried by
  wrong-lookup samples is reported as such") — reported, deciding nothing. "Of a candidate kind" and
  "the gate's intent is not met" were this author's additions after the pass and are WITHDRAWN. 0a
  passed as predicted; R1 failed; R2 failed as a conjunction; R4 passed; R5 failed. Conditions this
  author ADDED beyond the memo's gate (0a, 0c, 0d): replay 3 (added, run: R4 passed, R5 failed),
  harness 2.0, and the unfunded replays of 7.4 — labelled as the author's, not as the registered
  gate. Step 3's build stays gated on the registered 0d and on the owner's rulings above; nothing is
  armed for a full-turn cell before then.

**Caveats, stated once.** n = 20 per state, API-default temperature, one snapshot
(`claude-haiku-4-5-20251001`), thinking degraded on every request (0 blocks / 180). All 180 samples
are draws from nine byte-identical requests built from one history about one name; every claim in
7.2 about what Haiku does is a claim about that context. The four absence states (AFTER-ABSENCE, S3,
S4, S6) rest on a hand-built `rvtools_get_vms` turn whose `af_absent` envelope and `not_checked`
lines are AUTHORED and are NOT the host's shape — the host returns a bare wrapper there — and the
model's own path never produced a VM lookup (0 of 80 in CONTROL, CORRECTION, S1, S2; 0 of 20 in S5).
The absence the model's own path DOES reach (`_ps_absent_cluster`) was never replayed. The S2/S3 and
S5/S6 contrasts carry the vocabulary-echo confound, unfunded. The classifiers are deterministic and
their misses are recorded beside their counts (RESULTS § 3 (a)–(c); RESULTS2 § 3 (a)), never instead
of them; the estate split in replay 1 uses the page's candidate kinds and decides nothing. In the
fence test 36 of 45 measured turns are judged from tool names under a stated assumption, and no live
arm-C run has call-level arguments. Every dollar is an estimate at list prices; the record ran with
no caching.

---

## 8. Update 2026-09-24 — what shipped, what the first before/after showed, where step 3 stands

**Status:** record, not design. This memo's § 7 is kept exactly as written on 2026-09-23. This
section says what shipped since, and which of § 7's premises the next day moved. Section numbers
in this section are THIS MEMO's ("memo § 7.2 #5"), not the page's. Library facts are agentfootprint
9.114.0. Host facts are `host:` paths, with the host commit named where it matters.

### 8.1 Shipped

| release | memo item | what | commits |
|---|---|---|---|
| 9.113.0 | 2.3(i) | A batch that pauses settles its un-dispatched siblings on every resume path. One typed owner, `LLMMessage.notDispatched`, sits on the history message and on both halves of its bracket. | `3d2ba26e` |
| 9.113.0 | 2.3(ii), first half | `absent({ tryInsteadTool })` carries the suggested tool as data, on its own key (`try_instead_tool`); `try_instead` stays a string, and both ride `agentfootprint.tools.absent`. `notChecked[].kind` is NOT shipped (no reader). | `318e04cc` |
| 9.113.0 | step 1 (the row only) | `unsettled-by-absence`: a ruled-out standing whose only witness is a served absence gets a row beside it. The provenance TIER is not shipped (no reader). | `ec2ba08b`, `87c9a340` |
| 9.114.0 | 2.3(v), owner Q5 | `InputRequestDeclaration.absence`: a lookup that pauses to ask files, at the raise, the same `tools.absent` event and `coverageDeclared` row that the same `absent()` files when returned. A raise from an approved (gated) call stays an error and files nothing (stated in the CHANGELOG). | `a550b07b`, `8eb817f5`; release `63cd04e2` |

Not shipped: step 2's reader (`assessAnswer`, name open) was not started, and step 3 is on hold (8.4).

### 8.2 Premises of memo § 7 that the host has since moved

- **Memo § 7.2 #5 and #7 (the VM lookup's miss).** § 7 was written when `host:py-tools/server.py ·
  real_rvtools_get_vms` answered every miss with a bare wrapper. Since host commit `f047c41`:
  - a name the export does not hold is answered with `af_absent`;
  - a host or cluster that exists but runs no VM keeps `total: 0` (a true zero).

  So the four "authored absence" states are no longer, in kind, "a result this host never returns".
  Their WORDING still is not the host's: the host's `not_checked` names "a different kind of system
  — a storage array, a switch, a VM", not "whether such a machine exists at all". So no memo § 7
  number transfers.
  - #7's "the fence lifts on the VMware path" no longer holds for `rvtools_get_vms`.
  - It still holds for the host's other bare-zero lookups. The array lookup is being given the same
    declared absence at the time of writing.
- **Memo § 7.4's 0d.** An unarmed baseline ran on the night of 2026-09-23. It was arm A only, n = 10
  each on unknown-id-slow and vm-perf-on-array; that is not 0d's registered pair, because
  resolver-unknown was not run. It used blind double hand labels, with kappa.
  - Its record is the host's: `host:docs/measurements/selection-arms-2026-09-23-baseline-A.json` and
    `host:docs/measurements/labels/baseline-A-*`.
  - What it established that § 7 could not: the host's own pattern-based table scored a case 0/10
    that both blind raters scored 10/10.
  - So the host's bench now takes verdicts only from hand labels, and prints every reading of the
    reply's words as advice (`host:docs/measurements/README.md`, law 14).

### 8.3 The first before/after (2026-09-24): the test could not decide

**Design.** Single factor: the host with only its VM-lookup declared absence reverted, against the
host as committed.
- Both sides ran on agentfootprint 9.112.2, with Haiku 4.5, on case vm-perf-on-array.
- The rule was registered before the first paid call.
- One blind sheet covered 79 scored turns, labelled by two raters.
- Full record: `host:docs/measurements/2026-09-24-vm-fix-before-after.md`.

**Result.** Flagged means a claim of non-existence or an overclaim, marked by both raters.
- BEFORE: 3/30, all three from 09-23; the same code gave 0/20 on 09-24.
- AFTER: 2/29. Fisher p = 1.00.
- Not shown to work. The BEFORE condition disagreed with itself across two days (p = 0.03), by more
  than the effect the test was sized for.

**What the record does show.**
- The envelope reached the model (26/29) and changed its next move. Replies quote the export date
  and what was not checked, and 6 of 26 followed its hints, against 2 of 19 before.
- Both AFTER flags came through a DIFFERENT bare zero: the host's array lookup.

**Why no turn on either side reached the answer (0/59).** Two causes, both found after the run.
- Every seed timestamp is relative to the moment the seed was loaded, and the run read a bucket
  loaded more than a day earlier, so a 2-hour performance window read nothing.
- A seed row put a volume on one array while its WWN carried another array's serial, so the array
  lookup could not attribute the answer at any data age.

Both are host fixes: a fresh bucket per run, and the seed row re-keyed to its own array's serial.

**Rules for the next comparison**, now the host bench's own:
- run both sides the same day, interleaved;
- load a fresh bucket right before the run;
- take verdicts from blind hand labels only.

**Spend.** § 5's experiments came to $9.74 of the $10 cap: the replays $7.66 plus the baseline
$2.08. The before/after cost $6.35, under a separate owner approval. All figures are estimates at
list prices.

### 8.4 Step 3: on hold

Memo § 7 already withdrew "B is the enforcement core" and kept C′ behind a lookup. Nothing since
supports building either.
- The deny changes the next move, but no end-state gain is shown (memo § 7.2 #1).
- No wording tried moves the role (#2).
- The typed ask carries the model's guess when the model writes the choices (#6).
- A placement of any kind unlocks the collectors unless the answer binds (#8; Q6 is unruled).
- The one before/after the host could run showed day-to-day model variance larger than the effect
  it was sized to see (8.3).

Step 3 stays unbuilt until a same-day, interleaved, hand-labelled comparison on a corrected seed
shows an end-state gain for an armed cell.

What proceeds meanwhile is the part no reviewer contested: hosts declaring their misses, and the
library readers that make a declared miss visible. A bare zero is the one shape the library cannot
help with. 9.113.0's unsettled row and 9.114.0's raise-site filing both read only a DECLARED absence.

### 8.5 Library follow-ups a host's own audit surfaced (listed, not designed)

A host's 2026-09-24 duplicate-code check found jobs it still does itself that belong in a library.
Each needs its own design page before anything is built:
- **An exported reserved-key list.** The host hand-copies the honesty and absence key names into
  two modules.
- **A way for `body-foreign-tool` to fail a build.** Today it warns, so the host re-implements it
  to fail.
- **A carry primitive.** Subject and context carry across turns, and a second `.configure()`, which
  throws today.
- **Two lens exports the host rebuilt.** `makeTeachingHumanizer`, and row interaction on the
  artifact rows table; the host's copy of the first has already drifted.

And one from 9.114.0's review: a raise from an approved (gated) call files no absence. That is
stated in the CHANGELOG, and is a follow-up if a host needs it.
