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
