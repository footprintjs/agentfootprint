# Known, not sure, ask — honest answers from the record (design, 2026-09-23)

**Status:** DRAFT design, not built. Written against agentfootprint 9.112.2,
footprintjs 9.27.0, and the first host at its commit `05b7a2c` (2026-09-23). Every "today"
below was read in the code on 2026-09-23 by four read-only sweeps (the library, the field
record, prior art, and the control cases) plus an adversarial check of the claims the author
had already made to the owner; those corrections are in § 12, in full. **Review round 1**
(2026-09-23; four lenses — field, honest-or-labelled, facts, design — fifteen blocking
findings) was re-verified against the code and the recorded runs on the same day: all fifteen
held, none was rejected, and each is applied in place and listed in § 13 with what changed and
what the design still cannot do. **Review round 2** (2026-09-23; the same four lenses,
thirteen blocking findings) was re-verified the same way — every finding was read back against
the retained arm-A records, the host's seed, catalog and bench scripts, and the library's
sources — and all thirteen held, none rejected. They changed the SHAPE of the ask path: the
before-tool "ask with values" (round 1's form 1) is dropped for the door that already exists
(`requestInput` from the placing lookup that found nothing, gaining one typed field), the rule
for an unplaced subject gains the arm the flagship record actually reaches (a collector proposed
BEFORE any placing lookup ran), the subject placement becomes a library-owned row through a
declared port instead of a shape read out of `given`, and alias-006 is withdrawn as a measured
case because the seed holds ONE cluster ending in 006, not two. § 14 lists all thirteen with
what changed and what the design still cannot do. **Review round 3** (2026-09-23; the same four
lenses, fifteen blocking findings) was re-verified the same way — against `core/tools.ts`,
`core/inputRequest.ts`, `stages/toolCalls.ts` (the pause branch and `declareCoverage`),
`Agent.ts` · `resume`, `middleware/{types,errors}.ts`, `stages/route.ts`, `coverage/{types,
absent}.ts`, `integrity/{column-types,empty-lookup}/check.ts`, `lib/claim/claim.ts`, the host's
`py-tools/server.py`, `tools-catalog.json`, `src/{catalogTools,toolBindings,pyBridge,data}.ts`,
`src/routing/catalog.ts`, `be-server/routing.ts`, the two retained arm-A records and the
measurements file. All fifteen held in substance; two carried imprecise evidence (§ 15, R3-1 and
R3-3), and the check found FIVE facts this page itself had wrong that no finding raised — the
host declares `resultKind` on 82 of 90 catalog tools (an artifact-kind label, not a rowset
shape), its Python `af_absent()` helper has ~57 call sites, its TS mock's `absent()` is not the
library's envelope, the flagship SH… shape is multi-candidate, and two build constraints
(the input-declaration validator's key allow-list; the catalog binding's metadata law) gate
every new declaration. Round 3 changed the ask path again: the RAISE stays inside the placing
lookup, but the fact it raises on ("this is the last candidate lookup") is a library fold handed
to the tool, the miss it raises with is FILED as observed by a library reader (which is what
earns the typed `absence` field over the existing opaque `context` slot), the post-lookup deny
is replaced by a remaining-lookups arm, the pre-lookup deny loses the coverage clause it could
not witness, the placement row becomes a ContextFootprint `Assertion` through the port, the
person's answer gains a provenance tier (`answered`) and places the subject, `known` is reserved
for an answer with a SUPPORTING row, G7's output deny is struck, and the assessment row drops
its two copied fields. § 15 lists all fifteen with what changed and what the design still cannot
do. Nothing on this page is implemented. Facts found while building change this page, not a
chat.

**Where this sits.** [Declared control — what ships first](./2026-09-declared-control.md)
keeps the chart-free items (run facts, `solo`, five small items). [The no-model hop]
(./2026-09-no-model-hop.md) holds the chart-changing items and is marked not ready. This page
is the owner's proposed alternative to building more doors: make what the library already
knows about an answer TYPED, compare it against the record, and let the verdict act through
the doors that exist. It takes nothing away from the ship-first page (run facts is REQUIRED
by this design, see § 5.1) and it makes most of the hop unnecessary (§ 6).

**How to read it.** § 1 is the goal in the owner's words. § 2 is the grey-area map: one row per
field case, with what the record held at the moment the model guessed. § 3 is the thesis. § 4
says what exists today and whether it truly fits one form. § 5 names the primitives. § 6 shows
control as one instance and answers "which of the doors are still needed". § 7 places the prior
art. § 8 says how it is measured on the host. § 9 is the build order. § 10 the laws. § 11 the
open questions. § 12 corrects four claims the author made before the check. § 13 records the
fifteen round-1 corrections, one line each; § 14 the thirteen round-2 corrections the same way;
§ 15 the fifteen round-3 corrections plus the five page facts the check found wrong, and what
the design still cannot do after three rounds.

---

## 1. Why — the owner's ask

> "The main idea is: through [the host's] app, find the library's grey areas and make the
> library work well. The intention is we make the LLM say it if it KNOWS, say if NOT SURE, ASK
> the user, and HONESTLY reason WHY it has no idea." — the owner, 2026-09-23

Three sentences the model should be able to end a turn with, and the reason behind the third:

- **known** — "Client WKSP10368 did not appear in the observed traffic over the last hour
  (ps_client, -1h)." A claim that a row of the run's record supports.
- **not sure** — "Cannot determine slowness: no client samples were collected in the last hour;
  one unresolved warning event exists." A claim the record supports only in part, and the
  record says which part.
- **no idea → ask** — "I do not know what SHQZXPLAP941 is: its name matches no naming rule
  (its shape is an SH… machine name — an application server), no skill declares it, the VM
  inventory has no VM by that name, and the three PowerScale lookups I ran read samples, not
  whether it exists. Which system is it?" Nothing in the record places the subject — after the
  lookups that COULD place it, the ones declared for its shape's candidate kinds, were tried
  (§ 5.5, rule order) — and the reason is read off the record, not composed. The ask is raised
  by the last of those lookups when it finds nothing (`requestInput`, the door that exists);
  WHICH lookup is last is a fact the library folds from the record and hands to the tool, never
  a thing the tool knows on its own (§ 5.5; § 15, R3-7); and the miss it raises with is filed
  on the record as observed before the pause, by a library reader of the ask's typed `absence`
  field (§ 15, R3-8 / R3-9).

**The method.** The host is an agent over a storage and VM estate, built on this library. It is
the field test. Every grey area on this page was found by running the host, reading the record
the run left behind, and asking one question at the moment the model guessed: *what did the
record already hold?* The answer, in every case, was the same shape: the record held the fact
that the answer was a guess, and no layer compared the answer against it (§ 2).

**Why typed and ledger-based, not more doors.** The earlier direction added imperative loop
doors (an explicit action with no model call, a tool's result as the answer, a hop around
CallLLM). Three review rounds found their deepest problems in the library's own safety nets,
which all key on a model call having happened: `src/core/Agent.ts` · `integrityWorkExisted`
reads `llmLatestContent`; `src/core/runCheckpoint.ts` · `RunCheckpointTracker` is fed only by
`iteration_end`; and caller-claimed, app-given and checked data shared one field. A label and a
pause raised from the record touch none of those: the model call is never skipped, nothing
writes in the model's place, and every verdict is a row the lens prints. The prior art says the
same thing from the other side: an agent's own account of its work is not a reliable account
(§ 7), so an assessment derived from what happened beats a standing the model reports.

**What the library can honestly say at the end.** "The answer is consistent with the run's
record, and every declared claim is supported" — never "the answer is verified". A record can
prove *unsupported* or *contradicted*; it cannot prove *true* (§ 7, RV monitorability; the
ContextFootprint README's own boundary paragraph).

---

## 2. The grey-area map

Every row: what the model did; what the record held at that moment; the honest reply and where
its reason comes from; the moment it could have been caught and the door that exists there.
"Arm A" is the host's real routing; B its native deterministic cascade (no model call); C the
scored-entry setup; D partial scores; E the setup that puts the app's own subject reading in
front of the model. The 2026-09-23 run is Haiku 4.5, n = 1 per arm, 45 rows, on the host's
`docs/measurements/selection-arms-2026-09-23.json`; the event-level record survives on disk for
arm A only (host `src/agent.ts` · `seoTelemetry` opens ONE sink per process and the bench
starts five servers in one process), so arms B–E rest on the harness rows. That retention gap
is itself the first finding (§ 8).

### F1 · The step-B routing corpus

**unknown-id-slow — "is SHQZXPLAP941 slow" (a name in no seed and no naming rule).**

- *Model.* A read the PowerScale triage skill without any lookup, fired `pscale_op_latency`,
  `pscale_events`, `pscale_jobs` with `{ cluster: 'SHQZXPLAP941' }` in one batch — each filed on
  the findings ledger as `basis: 'direct', expect: 'high'` — got three `status: 'absent'`
  results and answered "The cluster SHQZXPLAP941 is not in the collected estate … Possible
  causes: … Cluster has been decommissioned." C answered "not present in the collected
  PowerScale inventory … no PowerScale clusters are currently collected" without running the
  inventory. D asked for the name in imperative form, still calling it a cluster. B asked
  "Which is it — powermax, powerscale, powerstore?" — honest in form, wrong facet values, no
  reason. E asked from the record: "No available skill covers application server performance
  diagnostics. SHQZXPLAP941 is cataloged as an application server (SH… machine name with no
  estate prefix) … Which VM, ESXi host, or physical storage client is it?" — and cost less than
  any guessing arm ($0.048 against A $0.097, C $0.174, D $0.188).
- *Record.* BEFORE the first dispatch the host's own resolver had written
  `compatibility.subjects: [{ span: 'SHQZXPLAP941', status: 'unresolved', origin:
  'identifier-shape', rule: 'catalog SUBJECT_SHAPES.shHost: an SH… machine name with no estate
  prefix (an application server)' }]` and `shadow.action: 'ask-facet'` into the shadow row
  (host `src/routing/shadow.ts`), while `agentfootprint.skill.turn_routed` carried `scores:
  all 24 = 0` — the scorer had no signal. AT THE ANSWER: three `agentfootprint.tools.absent`
  events, the first with `notChecked: [{ what: 'whether the cluster exists at all', why: 'this
  reads collected samples, not the cluster' }]` and `try_instead: '… check
  pscale_cluster_inventory …'`; `pscale_cluster_inventory` never ran;
  `agentfootprint.agent.evidence_checked { posture: 'guard', unsupported: [], action:
  'grounded' }`; every integrity disposition `not-applicable`.
- *Honest reply.* The one E gave, after the placing lookup declared for the subject's
  candidate kind has run — the resolver's rule says the shape is an application server, so the
  candidate lookup is the VM inventory (`rvtools_get_vms { vm }`, "look it up"), NOT
  `pscale_cluster_inventory`: that one is keyed on a cluster fragment, and it is the lookup the
  collectors' own `try_instead` named, which is why the earlier draft reached for it (§ 14,
  R1). On this name the VM lookup finds nothing, and THAT envelope is the ask's first reason —
  once the host returns it as `absent()`: today the backend the bench ran, `py-tools/server.py`
  · `real_rvtools_get_vms`, returns a bare `{ query, sorted_by, total, returned, vms }` wrapper
  on hit and miss alike (the vm-perf-on-array record holds `"total":0,"returned":0,"vms":[]`
  with an `af_provenance` field and no `af_absent`), which § 5.3's own fence makes
  not-applicable; the host's OFFLINE binding (`src/toolBindings.ts` · `rvtoolsGetVms`, taken
  when `pyBridge.ts` · `usePyTools()` is false) already returns `data.absent(...)` on a miss,
  but that is `data.ts` · `MockAbsence { not_found: true, count: 0, … }`, not the library's
  envelope either (§ 15, R3-P3). Moving the Python lookup to `af_absent()` — the helper
  `server.py` already calls at ~57 sites, none of them this function — is a build requirement
  of step 3. Plus what the collector envelopes add: "… the three PowerScale lookups found no
  samples but did not check whether it exists." Every clause quotes a row; the coverage clause
  quotes the envelope's own `notChecked[].what` verbatim — prose the lens may print and no fold
  may join (§ 5.3; § 13, F4). And the shape is not one-candidate: `src/routing/catalog.ts` ·
  `SUBJECT_SHAPES.shHost` "also matches every estate device name" — a residual SH… name that
  no estate rule placed could be a VM, an ESXi host or a physical storage client (arm E's own
  three-way question), so its candidate lookups are several, across skills (§ 15, R3-P4).
- *Moment and door.* The first before-tool moment on this record is a COLLECTOR batch keyed on
  the unplaced name BEFORE any placing lookup has run (`read_skill` → three collectors →
  answer; no `pscale_cluster_inventory`, no `rvtools_get_vms`, no middleware `deny` anywhere in
  the retained record). Round 1's rule had no verdict for that state — it defined "lookups ran
  and came back empty ⇒ ask" and "a lookup placed it ⇒ allow", so on its own flagship record it
  would have fired nothing and the run stayed byte-identical (§ 14, R1). The verdict is now
  defined: a `ToolMiddleware.onToolCall` `deny` on a collector keyed on an `unplaced` subject
  while any declared placing lookup for its candidate kinds has not run, whose sentence is
  composed from rows that EXIST at that moment — the placement row's rule and the not-yet-run
  lookups (a join over `resolves`, § 5.2) — and, once a candidate lookup HAS run empty, the
  envelopes it returned quoted verbatim (`notChecked[].what`). Round 2 gave the pre-lookup
  sentence a third clause ("existence was not checked by anything yet; the collectors you
  proposed read collected samples, not whether it exists") with no row behind it: at the
  before-tool moment the collectors are denied and never run, so no envelope exists, and a
  `Tool` carries no static coverage declaration (`core/tools.ts` · `Tool`: `capabilities`,
  `resultCeiling`, `resultClass`, `resultKind`, `resultColumns`, `argumentsFrom`, `gates`,
  `repeatedWhen` — nothing coverage-shaped). The clause is cut (§ 15, R3-2 / R3-6); the
  coverage boundary lives only where an envelope holds it. It is a correction the model reads
  (the door the host's `05b7a2c` fix uses); note the three collectors were ONE batch
  (`parallelCount: 3`), so a pause anywhere in it leaves siblings unanswered — § 5.5's batch
  settlement. The ASK is not raised at before-tool: the honest model asks in prose after an
  empty lookup (no tool call, so no before-tool moment exists), and only a model proposing a
  SECOND collector would reach one — round 1's ask fired on the guessing model and never on
  the honest one (§ 14, R4). It is raised where the record has the reason: inside the placing
  lookup that found nothing, by `requestInput` carrying the absence as a typed field, on the
  library's own fact that this lookup was the LAST candidate for the subject (§ 5.5; § 15,
  R3-7) — and that absence is filed as `tools.absent` / `coverageDeclared` by the pause branch
  BEFORE the checkpoint is returned, so the asking lookup's miss is on the record as observed
  like every other (§ 15, R3-9).
  After the batch — three `status: 'absent'` results are routable by `onToolStatus`
  (`src/core/agent/coverage/absent.ts` header). Before the answer — "is a cluster", "not in the
  estate", "decommissioned" contradict two typed readings the record held (resolver:
  unresolved; envelope: existence not checked — the latter prose today, § 5.2), and nothing
  held the answer's claims in typed form, so `unsupported-claim` was not-applicable. What is
  missing is not context; it is a comparison, a deny that names the next door, and an ask that
  carries its reason (§ 5.5).

**alias-006 — "is 006 slow" (the bench label says two collected clusters end in 006; the seed
holds ONE).**

- *Model.* All five asked, in prose, with no tool call (measured: `asked: true, clarified:
  true`, zero collectors, on every arm). A's ask came from the evidence gate, not from routing:
  its first draft named `mds-006` and `fc1/6`, two invented identifiers; the `guard` posture
  caught them (`route_decided … 'evidence-recheck'`, `evidence_checked { unsupported: [mds-006,
  fc1/6], action: 'revision-asked' }`) and the revision asked what "006" refers to. Nobody ran
  the inventory, although `lookupAllowed` permitted it.
- *Record.* Shadow `subjects: []` (a bare 006 matches no shape), `shadow.action: 'ask-facet'`
  with `values: ['powerstore', 'powerscale']` (product facets, not cluster names) and
  `candidates: ['powerstore', 'pscale-triage']` (skill ids). NO row at the door holds any
  cluster name: the catalog holds naming RULES, the cascade's `'legacy-numeric-ambiguity'` is
  the router's two-skill near-tie, and cluster names exist only behind
  `pscale_cluster_inventory` (its `cluster` parameter: "cluster name or any fragment of one,
  e.g. '006'") — a tool call, a run (§ 13, F3). **And what that call would return (§ 14, R2 /
  R13):** the seed holds exactly ONE `ps_cluster` row ending in 006 — `SHISOLPLPAP006` (the
  other cluster is `SHISOLPRNAP007`); `SHISOLPRNAP006` is not a cluster row at all, it appears
  only as `target_host=` on two `ps_synciq_policy` rows (host `py-tools/seed/influx/
  11-powerscale.lp` lines 127–128; `src/data.ts` · `PSCALE_CLUSTER = 'SHISOLPLPAP006'`;
  `src/toolBindings.ts` · `pscaleClusterInventory`: "The PowerScale mock carries one cluster";
  `data.ts` · `sameName` is a substring match, so `'006'` matches that one row on either
  backend). The bench label (`scripts/bench/selection-questions.ts` · alias-006: "two seeded
  clusters end in 006 (SHISOLPLPAP006, SHISOLPRNAP006)") and the earlier text of this row were
  wrong about the seed, so a "truth oracle from the seed" (H2) would have inherited the error.
- *Honest reply.* After the inventory lookup: "006 matches one collected cluster,
  SHISOLPLPAP006; SHISOLPRNAP006 appears only as a SyncIQ replication target of it. Checking
  SHISOLPLPAP006 — say so if you meant the DR target." — a KNOWN placement (the inventory's
  one row) plus a second fact from the SyncIQ rows, sayable only AFTER the lookup, never at the
  door. The "which of the two?" reply the earlier draft promised can be read from no row.
- *Moment.* After the inventory result the moment is after-tool, and after-tool has NO `ask`
  — by the code (`src/core/agent/middleware/types.ts` · `ToolResultOutcome = AllowOutcome |
  DenyOutcome`) and by the law § 10 keeps; the earlier draft called an after-tool ask "form 1"
  (defined at before-tool) and rested it on `|matches('006')| ≥ 2`, which the seed never makes
  true (§ 14, R2 / R5 / R13). The typed carrier for "several match, none chosen" is on the
  tool's own RESULT: `semantic({ facts, clarify: { question, candidates } })`
  (`src/lib/semantics/types.ts` · `SemanticClarify` — "hand the question and the candidates
  back, typed, so the loop (or a UI) can ask"; on the record whole as
  `tools.semantics_declared.semantics.clarify`), which the inventory tool returns when a
  fragment matches N ≥ 2 rows — app work on an existing shape, with no rowset declaration
  needed for the tool to count its own rows. On THIS seed N = 1, so alias-006 is withdrawn from
  the measured set until either the seed gains a second 006 `ps_cluster` row (and the label
  stays) or the label is corrected to what the seed holds (oracle: `known` after the lookup —
  H2); with the label corrected, the honest reply above is the oracle and E's prose ask at
  $0.040 is a bench miss of the resolver-unknown kind. Before the answer, the value gate does
  its job on invented identifiers and shows its ceiling in the same turn: it can turn a guess
  into a question, but not make the question specific, because it reads values, not the
  record's candidates (`src/core/agent/evidence/gate.ts` header: set membership over
  normalized tokens is the entire mechanism).

**vm-perf-on-array — "how are the VMs on SHPMAXPRDCL001 performing".**

- *Model.* A's tier-1 rule chose the ESXi inventory skill; the model called `rvtools_get_vms
  { host: 'SHPMAXPRDCL001' }` — an array name in the ESXi `host` slot — got `{ total: 0,
  vms: [] }`, then `vrops_get_vm_perf` with no filter (`vm_count: 0`), and answered "No VMs are
  currently hosted on SHPMAXPRDCL001." The bench scored it MATCH (a right-domain collector ran
  without error). B declined with "Naming the system or the identifier would let me route it"
  — the system WAS named and B's own catalog had resolved it. C and D asked questions the
  catalog answers by rule.
- *Record.* Shadow: `subjects: [{ span: 'SHPMAXPRDCL001', kind: 'powermax-array', status:
  'resolved', origin: 'estate-naming-rule' }]` — a strong placement. The `host` parameter's
  operand exists only as prose in the tool's JSON-schema description ("ESXi host name"). The
  empty result is a bare `{ total: 0 }` wrapper, not an `absent()` envelope, so `tools.absent`
  and `empty-lookup` never fire; `unsupported-argument` filed `checked-pass` because the value
  came from the user message (it judges provenance, never kind).
- *Honest reply.* "SHPMAXPRDCL001 is a PowerMax array (naming rule). The VM inventory is keyed
  by ESXi host, so a host lookup on this name finding nothing says nothing about the array. To
  list the VMs on it I need the volume → datastore → VM mapping — shall I run it?"
- *Moment.* Before dispatch — subject kind (`powermax-array`, typed) against the parameter's
  operand (`esxi-host`, prose): no layer compares them because tools declare argument kinds
  only as free text. After the result — a `total: 0` on a key of the wrong kind became "no VMs
  are hosted", a claim from grounded tokens (the gate passes). Two grey areas: argument kind is
  never checked, and the deterministic router's decline denies what its own catalog resolved —
  against the law `host src/routing/router.ts` · `clarify` states for itself ("it may omit, but
  it may not deny").

**resolver-unknown — "is epic-cache-07 slow" (a seeded VM the resolver cannot classify).**

- *Model.* All five missed. A read the PowerMax performance skill (the name contains "cache";
  the host's catalog even warns against that vote), called `pmax_get_sg_perf { array_id:
  'epic-cache-07' }` → `{ count: 0, rows: [], empty_reason: '… this does look like a
  collection gap.' }`, then `pmax_get_inventory` → `{ arrays: [], count: 0 }`, and answered
  "This identifier is not recognized as a PowerMax array, storage group, or host name" — a
  host lookup never ran. D ran ten iterations, $0.34, and its reply finally said "If it's a VM,
  use esxi-inventory" — it named the right door and did not take it. E asked without any lookup
  ($0.046) — and the bench scored that a MISS (`expected: 'answer'`, `unnecessaryClarification:
  true`): the seed holds the VM, and a name lookup (`rvtools_get_vms { vm }`, "look it up")
  would have placed it. The cheap ask is honest only after the lookups that exist came back
  empty (§ 5.5, rule order; § 13, F6).
- *Record.* Shadow `subjects: []`; scorer all 0; four `empty-lookup` dispositions
  `not-applicable` (bare wrappers, and the PowerMax tools declare no `argumentsFrom`). The
  tool's own `empty_reason` branch writes "collection gap" whenever the measurement has no live
  rows in range, whether or not the id exists (host `py-tools/server.py`, the four
  `empty_reason` arms) — so an absence became an outage in the record itself.
- *Honest reply.* "No naming rule places epic-cache-07. Its shape could be a VM name; checking
  the VM inventory first" → `rvtools_get_vms` finds it → perf. Or, if the app prefers to ask:
  "I cannot place epic-cache-07 — is it a VM, an array, or an application label?" For the
  design to LABEL that turn `known` the hit must be a declared placement: today the hit is the
  same bare `{ total, returned, vms }` wrapper as the miss, which no library reader recognises
  as rows (`integrity/column-types/check.ts` · `readRowset` and `empty-lookup/check.ts` ·
  `readLookupResult` read a TOP-LEVEL array only; a `{ rows: [...] }` wrapper is
  `not-applicable` by their own doc) — so step 3's app half must declare the hit as well as
  the miss (§ 5.5, "What counts as a hit"; § 15, R3-3 / R3-12). Note also that the recorded
  arm A, after `pmax_get_inventory` came back `{ arrays: [], count: 0 }`, asked in PROSE at
  iteration 4 — it proposed no further collector — so the state the record reaches is "some
  candidate lookups empty, the VM lookup not yet run, and no before-tool moment", where only
  the Route label applies (§ 15, R3-1).
- *Moment.* Before dispatch (an unplaced subject into an `array_id` slot — the same
  kind-vs-parameter gap); after the first result (the tool's sentence IS the guess; the
  library's absence rails cannot see it because it is not an `absent()` envelope); before the
  answer ("not recognized as … host name" was never checked).

**field-client-talk — "did client WKSP10368 talk to SHISOLPLPAP006".** All five matched. A's
`pscale_client_activity` returned `af_absent` with `checked: [{ what: 'ps_client over -1h' }]`,
`not_checked: [{ what: 'whether the cluster exists at all' }]`; its reply said "**No.** … over
the last hour" — honest, though the definitive "No." outruns "no samples in -1h". C's reply said
"within the past 6 hours", E's "over the last 30 days of available data" (unverifiable — the
raw record is not on disk). A stated window is not identifier-shaped, so the value gate's
extractor never sees it. The residual grey area is the answer overstating the ground the
envelope covered — window, existence — a coverage-vs-claim comparison the record makes
representable and nothing decides.

**field-slow-powerscale — "is SHISOLPLPAP006 slow".** A, D and E were honest ("Cannot determine
slowness — no client activity data collected … one unresolved warning event exists"), stated
from a runbook that refused to walk with no samples and handed the absence through whole
(`src/core/runbook/dispatch.ts` · `call`, `RunbookAbsenceSignal`). C ran `pscale_op_latency`
and `pscale_topology` only and answered "**No PowerScale clusters are currently collected.** …
no real PowerScale cluster named SHISOLPLPAP006 exists in the collected data" — contradicted
by the seed and by the events row A, D and E received — and scored MATCH. C's sentence is an
EXISTENCE claim, closed only by a claim class (§ 5.2, step 6), never by the assessment row alone
(§ 8.2). Tier-4 cost signal:
`score_skills` refused 2 of 3 calls in C and 3 of 4 in E, each a paid round trip. The runbook
is the right precedent for "not sure"; the bench needs a truth rail of its own.

**all-refused-protocol — "show the ExtraHop HTTP records …".** A declared refusal is the best
honest form seen in the run. B, deterministic, from `assessRequestedSource` → `source.status:
'unsupported'`: "The declared ExtraHop tool reads SMB/CIFS records, not HTTP records. … no
protocol has been silently substituted." — stated from a declaration, no model call. A answered
from the descriptions in one iteration and offered SMB. Nothing had to be inferred, because the
app DECLARED the limit as data. This is the template for every other row.

### F2 · The checked-analysis guard discarded a correct answer

- *Model.* In ordinary chat it read the ESXi skill, got the four disks with sizes from
  `rvtools_get_vm_disks`, then also called `analyze_vm_disks { operation: 'list-disks' }`.
- *App.* The guard's provider wrapper (`host be-server/protectedAnalysisFlow.ts` ·
  `admitTypedResponse` at `bfd4e35`) inspected the reply BEFORE the library's correction loop,
  replaced it with a fixed refusal, stripped the calls and returned `stopReason: 'end_turn'`.
  The turn ended with a refusal as the whole answer; the inventory answer the model already
  held was thrown away.
- *Record.* A tool result with the disks (enough to answer); a proposed call whose argument
  fails the tool's own `inputSchema` enum — a fact `src/core/agent/toolArgsValidation.ts` ·
  `validateToolArgs` (`'enforce'` by default) turns into a correction; the whole batch already
  in `ctx.history` (the app's stated reason "middleware sees one call at a time" was false —
  `stages/toolCalls.ts` pushes the assistant turn with ALL its tool calls before the per-call
  loop).
- *Honest reply.* The inventory answer (known) plus, as that call's result, "listing the disks
  is not a checked analysis".
- *Moment and door.* At dispatch — `ToolMiddleware.onToolCall → deny(reason)` reaches the model
  verbatim as the tool result and the run continues; a calculator refusal on the model-chosen
  door becomes a `status: 'failure'` envelope, never the turn's answer. Fixed in the host at
  `05b7a2c` with exactly that door; the guard's header now reads "it exists so an unchecked
  number is never PRESENTED AS a checked result. It must not force the path". The bug class,
  named on the ship-first page: a rule enforced BEFORE the library's correction loop turns a
  fixable mistake into a refusal that ends the turn.

### F3 · Tier-4 scored entry picked io-profile for a PowerScale cluster (host `1a94f98`)

- *Model.* Rated io-profile HIGH ("designed to profile IO workload for one initiator or
  host, which fits"), read it, called `rvtools_get_host_hbas` against the cluster name →
  `{ hba_count: 0, hbas: [] }` (a bare empty rowset, no `absent()` envelope), reported it could
  not tell whether the cluster was slow.
- *Record.* The catalog's `ESTATE_NAMES.powerscale` rule had resolved SHISOL… as a PowerScale
  cluster; io-profile's declaration (host `src/routing/declarations.ts`) carries `excludes:
  ['powerscale-cluster', …]` and its verbatim NOT sentence. Re-running the pure
  `assessDirectory` over the same utterance today yields io-profile INCOMPATIBLE (a supported
  negative) — yet tier 4's `score_skills` rows are a model judgment never compared against the
  app's verdict; even arm E states "Nothing is excluded and admission is unchanged". The fix
  was a description edit.
- *Honest reply.* "SHISOLPLPAP006 is a PowerScale cluster; io-profile is declared not for it,
  so zero HBAs is expected, not a finding" — and the triage walk.
- *Moment.* At `read_skill` admission — a skill rated high that the app's declaration holds
  incompatible for every placed subject is refused with the skill's own NOT sentence, a
  correction. The one grey area where the app already has the typed reading AND a comparison
  function; only the consultation at the moment is missing.

### F4 · The production report (2026-08-29): zero read as absence

- `flogi_database.port_wwn` filtered before the pivot → every reverse WWPN lookup returned
  empty, and the tool prose said "not currently logged in to any port … check cabling" during a
  live incident. LUN 0 stored as `''` (`str(x or "")`, 0 is falsy) on 2,094 mappings. An 8 MiB
  identity disk rendered "0.0 GB".
- *Record.* The WWPN came out of an earlier result in the same run and the lookup keyed on it
  returned `[]` — for every WWPN, always. That is the predicate of `src/integrity/empty-lookup`
  (9.77.0, born from this report; `EMPTY_LOOKUP_CEILING`: "a place to look, never a verdict
  that anything is wrong"). Today the host arms `noticeEmptyLookups`, but `argumentsFrom` is
  declared on seven VM tools only, not the WWPN lookups — so the exact F4 pair is still
  invisible to the check. The two collector bugs are the founding cases of
  `src/integrity/column-types` (`Tool.resultColumns` + `checkColumnTypes`); the host declares
  no `resultColumns`, so `column-type-mismatch` / `missing-column` are `not-applicable` in every
  disposition of the run.
- *Honest reply.* "The reverse lookup for <wwpn> found no FLOGI row on any collected switch —
  and it found none for any of the N WWPNs I asked; treat this as unknown, not as
  not-logged-in."
- *Moment.* At the write seam for empty-lookup; at the tool's answer for column types; and a
  run-level fold nothing does today — "every lookup in this run was empty" (N of N) is
  countable from the ledger.

### F5 · The input rewrite never reached the model (fixed, 9.112.2)

On `run({ continueFrom })`, `followUp()` and `standingAgent`, the input chain ran and its
verdict was discarded before the wire: the model answered a question it never saw (the quoted
line was never sent). The record held two readings of one subject — the middleware ledger row
said the rewrite happened (`middlewareDecisions[i]` with `changed` / `before`), the wire held
the raw text — from two provenances, never compared. That is the `conflictsOf` shape. Fixed at
the root by `src/core/agent/stages/seed.ts` · `historyForTurn` owning the turn's user entry.
Listed because the same angle catches a LIBRARY bug, not only a model guess.

### What the map says, in one line per grey area

| grey area | typed reading the record held | untyped side that guessed | where |
|---|---|---|---|
| A · subject resolution | resolver `status` / `kind` (host `src/routing/subjects.ts`) | the answer's kind claim ("the cluster", "that host") | F1 unknown-id, resolver-unknown |
| B · absence ≠ non-existence | `absent()` `notChecked` / `tryInstead` — both PROSE today (`{ what, why? }`, a string); typed by § 5.2's coverage vocabulary | "not in the estate", "decommissioned", "not collected" | F1 unknown-id, field-slow (C) |
| C · zero ≠ absence, argument kind | subject kind by a strong rule; `SUBJECT_KINDS` vocabulary | a parameter operand as prose; `{ count: 0 }` read as outage | F1 vm-perf, resolver-unknown; F4 |
| D · the value gate's ceiling | `expect: 'high'` filed BEFORE the result; a value that survived its one revision | a flagged answer that ships with a console warning | F1 alias-006; discarded field-vm-disks attempt |
| E · the deterministic router's sentences | the same catalog's verdict object (`expects`, `values`) | fixed sentences computed without reading it | F1 vm-perf (B), unknown-id (B) |
| F · declared compatibility vs model rating | `assessDirectory` verdict with the NOT sentence | `score_skills` fit 'high' | F3 |
| G · coverage window vs stated window | envelope `checked` | "past 6 hours", "30 days" | F1 field-client-talk |
| H · the bench's own rules | the seed (truth) | MATCH never reads truth; ASKED is a '?' regex; the alias-006 label asserts two seeded clusters where the seed holds one | § 8 |

Every row is two current readings of one subject where today at most one side is typed. That
is exactly the comparison ContextFootprint's `conflictsOf` performs — for pairs whose both
sides are asserted. The missing work is (i) making the untyped side a declared assertion at the
answer and at dispatch — and, on the record's side, typing the two coverage fields that are
prose today (`tryInstead`, `notChecked[].what`) — and (ii) one fold at three moments that files
the conflict as a correction the model reads, a label the app renders, or a typed question to
the person.

---

## 3. The thesis

**An answer's assessment — known, not sure, no idea → ask — is derived from typed assertions
over the run's record, each with a provenance, never from the model's report of itself.**
(The derived row is called the ASSESSMENT from here on: in this library `standing` is the
MODEL's declared word, and the checker's verdicts must never share a name with it —
`src/core/agent/findings/types.ts` header; § 13, F11.)

Five consequences, each one a rule the rest of this page obeys:

1. **Typed on both sides.** An assessment is a comparison, and a comparison needs two typed
   readings of one subject. Where the record's side is typed already (a resolver verdict, an
   `absent()` envelope, a receipt, a declaration), the work is to type the answer's side (a
   claim contract, a parameter kind, a declared expectation). Where neither side is typed —
   prose against prose — the library files nothing. Attribution over prose tops out near 80%
   even for fine-tuned judges (§ 7); "prose files nothing, ever" stays.
2. **Checked at declared moments.** Before dispatch (the call's arguments against the subject
   the record placed), after the result (the tool's own coverage against what it returned),
   before the answer (the answer's claims against settled facts, absences and gaps), at turn
   end (the fold that writes the assessment row), and at the door before a run starts. Every one
   is a moment the loop already has (`src/core/agent/moments.ts` · `LOOP_MOMENTS` is a closed
   list of five, pinned by the compiler; a sixth moment fails the build). No new stage, no new
   branch on the chart, no hop.
3. **Verdicts act through the doors that exist.** A rule broken by the MODEL comes back as a
   correction the model reads: a tool-middleware `deny(reason)` is the tool result and the loop
   continues (`src/core/agent/middleware/types.ts` · `DenyOutcome`); `validateToolArgs` does
   the same for shapes; an after-tool `allow(value, why)` annotates what the model reads while
   both versions are committed. Before the answer the library can today withhold (message
   `deny`, `.answerValidation()` enforce) or record (`.claims()`, `observe`) — so the assessment
   is first a LABEL on the record, and a correction at the answer seam is named as the one new
   branch it would need (§ 12, C2). An ASK exists only where a pause exists, and the only pause
   in the loop is the tool boundary (`middleware/types.ts` header: "`ask` exists only where a
   pause exists … inventing a second pause … would be a worse answer than not offering it") —
   which includes the tool's own `execute`: `requestInput` raised from inside a tool rides that
   same pause, and it is the door this page's ask uses — raised on a fact the LIBRARY folded
   and handed to the tool, never on run facts the tool cannot see (§ 5.5; § 14, R10; § 15,
   R3-7 / R3-9). There is no `ask` at after-tool and none at Route; a model that asks in prose
   pauses nothing.
4. **The reason is read from the record, never generated.** Every clause of a "not sure" or an
   "I do not know" names a row: which value no result carried, which envelope said existence
   was not checked, which resolver said unresolved and by which rule, which lookup came back
   empty and how many others did. The findings ledger's first law is the assessment's first law:
   never infer — no row, no clause (`src/core/agent/findings/types.ts` header: "Nothing in this
   folder infers: an absent declaration is absent on the record").
5. **Self-report stays, as a declaration the record can contradict.** The model's own
   `_findings` standings, its `expect: 'high'`, its `score_skills` fit, a verbalised "not sure"
   field — all are `judged` assertions (§ 5.1). They are kept, filed, and compared; they never
   decide. Verbalised confidence is overconfident and nearly blind to answerability (§ 7), and
   under binary grading guessing is the model's optimal policy — so the bench must score
   "I don't know" as 0 and a wrong confident claim below it (§ 8).

**The one law that decides expressibility** (from the control sweep, § 6): an assertion is a
fold over rows at an existing moment; it can LABEL, REFUSE (a typed error), CORRECT (deny, arg
issues, evidence recheck) or ASK (where a pause exists). It cannot move the cursor: start a
tool without a model call, end a turn on a tool's bytes, or write in the model's place. Every
row on this page marked "needs a door" is a cursor move; every other row is an assertion.

**What the record can and cannot say.** It can say "this value was typed rather than read",
"this value rests on a lemma the model set aside", "this claim contradicts a settled fact",
"this subject was never placed", "existence was not checked", "this lookup was empty and so
were the other N". It cannot say "this answer is true" (RV monitorability — § 7); it cannot see
a wrong claim assembled from grounded tokens without a claim contract (`src/integrity/
unsupported-claim/README.md`: "it cannot catch a FALSE CLAIM ASSEMBLED FROM REAL VALUES"); and
it cannot judge ROLE — whether a placed subject is what the question operates on or only its
context — so every routing assertion is a supported negative or it does not fire (§ 6, cases
4–5; the adversarial hunt measured identity-as-role false exclusions at 40 of 47 context
questions).

---

## 4. What already exists — and whether it truly fits one form

Fifteen mechanisms decide or record whether an answer is supported (fourteen in round 1;
`semantic({ clarify })` was missing — § 14, R10). All are typed and provenance-aware; almost
all are detection-only labels. The column "fits" says whether the
mechanism is already an instance of the assertion form, or a separate substrate that FEEDS it.
Unify, never duplicate: nothing below is rebuilt.

| mechanism | lives | asserts | when | verdict today | fits |
|---|---|---|---|---|---|
| ContextFootprint `conflictsOf` | separate package (`contextfootprint` 0.1.1, a dependency of this library; the host also vendors a private 0.1.0 tarball and imports it directly — both ship the same tuple default key, § 5.1) | pairs of `asserted` values on one single-valued key; `participates()` excludes `undefined` and `{ kind: 'unknown' \| 'not-applicable' }`; identity = `assertionKey` (the tuple) unless a caller passes its own — the library's wrapper passes its legacy delimiter key, the host passes none | whenever a host calls it | names pairs, decides nothing; an empty result means "no conflict among what was supplied", never "verified" | THE algebra. The assessment row is a consumer-composed row over it |
| findings ledger `.findings()` | library `src/core/agent/findings/` | model-declared `BasisRow` (before the result) and `StandingRow` (fact / open / noise / ruled-out, with `settles`, `line`, `assertions[]`); `ConflictRow` via `conflictsOf` over `fact` rows; `ContingentRow` (9.110.0) | peeled at dispatch (`_findings`) and at the answer (`reserved.ts` · `peelAnswerFindings`) | no branch changes, nothing blocked; served back as a request-only piece | fits: fact rows ARE `Assertion`s (stratum is a declared mapping). Gap: `peelAnswerFindings` accepts per-RESULT standings only — the answer has no standing of its own |
| integrity family | library `src/integrity/**` | a decidable contradiction per check at five seams (write / compose / wire / choice / claim); a `Disposition` on every encounter | at the seams; `route.ts` · `judgeClaims` last | labels only; `unsupported-claim` "never re-routes"; a declared `null` / 'unknown' where the run verified a value is an ADVISORY ("doubt is not contradiction"); `assertAlive` fails a run whose registered check filed nothing | fits: `src/integrity/assertion/conflicts.ts` delegates to contextfootprint. Not rendered by the lens (0 files reference `contextErrors` or dispositions) |
| evidence gate `.namesAndNumbersFromEvidence()` | library `src/core/agent/evidence/` | every DATA token of the answer appears in some `role: 'tool'` message of the LIVE window (`evidenceIndex.ts` header: "this corpus is the LIVE WINDOW") | Route, after schema and step judge (`route.ts` · `judgeEvidence`) | `assist`: flag (`scope.unsupportedValues`, a `console.warn` via `gate.ts` · `evidenceRefusalSentence`, the answer ships unchanged); `guard`: ONE `evidence-recheck` turn, then flag; `rails`: then `UnsupportedValuesError`; a truncated index downgrades every posture to record-only | a separate substrate (tokens; no subject or predicate). Its per-VALUE verdict becomes REASON rows of the standing (`value-unsupported`, `value-survived-revision`); it is never the standing |
| coverage and absence | library `src/core/agent/coverage/` | a tool's own `checked` / `notChecked[{ what, why }]` / `cannotCover`; `absent()` = "I looked HERE and there is nothing" with `tryInstead` | at dispatch, before the result ceiling; `status: 'absent'` routable by `onToolStatus` | none; `.limitsTravelWithTheAnswer()` APPENDS the folded block (`prepareFinal.ts` · `composeAnswerWithCoverage`) | fits as `observed` assertions with a subject (the tool's coverage). Never JOINED to the answer's claims today — the join exists only as a bench scorer (`src/ontology/score.ts` · `scoreAbsence`) |
| `Claim<T>` | library `src/lib/claim/claim.ts` · `known` / `unknown(reason)` / `notApplicable` / `isKnown` / `describeClaim` | the library's own facts about itself (a map cursor, a cache hit-rate) | n/a (a type) | n/a | the VOCABULARY of "not sure with a reason" as a type; ContextFootprint honours the same shapes. Never applied to the model's answer today |
| `.answerValidation()` | library `src/answer-validation/` | host-authored `AnswerCheck { id, disposition, reason?, evidenceRefs? }` over a detached, canonical, schema-accepted candidate; refs resolved head-first from the run's artifact scope (`evidence.ts` · `createAnswerEvidenceResolver`) | wraps Route's `final` (`stages/answerValidation.ts` · `withAnswerValidation`) | `enforce`: `$break` + `AnswerValidationError`; `observe`: recorded; the callback cannot replace content; never asks; `unverified` (refs unreachable) counts as failure | ALREADY a typed assertion over the record — the receipt the word "checked" needs (§ 6). Refuse-or-deliver only |
| `.claims()` | library `AgentBuilder.ts` · `claims()` (refused without `.outputSchema()`); `src/integrity/unsupported-claim/check.ts` | a typed answer field against a `semantic({ facts })` row the run settled | Route, last | advisory finding | ALREADY a typed assertion over the record. Unarmed in the host (needs three declarations it never made) |
| tool middleware · `validateToolArgs` · `PolicyHaltError` | library `src/core/agent/middleware/`, `toolArgsValidation.ts`, `src/security/PolicyHaltError.ts` | governance verdicts per call and per result; a schema check; a policy halt | before-tool / after-tool / dispatch | `deny` = a correction the model reads; `ask` = a consent pause (approve / decline); `formatToolArgIssues` as the result; halt = typed throw | the correction VERBS a verdict acts through; not assertions |
| the four ask doors | library `src/core/pause.ts` · `pauseHere` / `askHuman` / `requestInput`; `core/checkin.ts`; middleware `ask` | a person's reply is a tool's result; typed missing-input collection (`core/inputRequest.ts` · `AwaitingInput.missing[]`); evidence-carrying consent | raised by APP CODE — a tool's execute or a middleware; never by the model, never from the record | pause; resume with a decision (`ask`, `checkIn`) or with values (`requestInput`, `askHuman`) | the TRANSPORT of a typed question reaches the host UI end to end (`hosting/types.ts` · `HostRequest.decision` / `awaitingInput`), and the pause is ALREADY on the record whole (`RunnerBase.ts` · `emitPauseRequest` mirrors the entire `pauseData` as `pause.request.questionPayload`; for `requestInput` that is `{ toolCallId, toolName, question, awaitingInput }` with `requestId`, fields and `origin.toolCallId`). The declaration already carries an opaque `context?: Record<string, unknown>` slot ("authored by the collecting tool, never editable by the reply"; validated by `core/inputRequest.ts` · `validateInputDeclaration`, JSON ≤ 16384 chars; handed back to the model on resume as `InputResponseResult.context`), so a tool can put an absence there TODAY. Missing: a LIBRARY READER — nothing files what `context` holds as `tools.absent` / `coverageDeclared` / the `empty-lookup` seam, because a tool that throws `requestInput` returns no value and `stages/toolCalls.ts` · `declareCoverage` runs only on the returned value; and the FACT the tool raises on ("this is the last candidate lookup"), which `ToolExecutionContext` cannot supply (`toolCallId`, `iteration`, `signal`, `credentials`, `artifacts`, `wanted`, `credential`, `progress`, run/session identity — no history, no prior results) (§ 5.5; § 15, R3-7 / R3-8 / R3-9) |
| `semantic({ clarify })` | library `src/lib/semantics/types.ts` · `SemanticClarify { question, candidates }` | the ask-vs-answer decision AS DATA on a tool's own result — "a tool that matched three volumes for one WWN should not pick one silently — it should hand the question and the candidates back, typed" | the tool moment; on the record whole (`events/payloads.ts` · `ToolSemanticsDeclaredPayload.semantics`) | records; the loop or a UI asks — no pause of its own | the typed carrier for "N match, none chosen" (alias-006's shape when N ≥ 2); missing from round 1's list (§ 14, R10) |
| the compatibility shadow | APP (host `src/routing/compatibility.ts` · `assessDirectory`, `shadow.ts`; served in arm E by `be-server/routing.ts` · `subjectEvidenceCarry`) | subject kind vs a skill's declared `subjects` / `excludes` — supported negatives only ("A GUESS NEVER DECIDES") | pre-call | "would exclude"; excludes nothing; off by default | `given` assertions the library sees only as served text |
| the host's data-side checks | APP (`be-server/vmInventoryFacts.ts` · `inspectVmInventoryFacts`; `metrics/server/answer-facts.mjs` · `profileFacts`) | RVTools rows as assertions keyed `(source, digest, vm, disk)`; displayed scalars vs qualified assertions at `epoch === view.revision` | before anything is served | typed refusal (`VmInventoryEvidenceError` → CONFLICTING_EVIDENCE); HTTP 400 | already the owner's shape, on the DATA side only; the honesty wording (`ANSWER_PURPOSE_CONTRACT`) is hand-authored prose |
| the runbook | library `src/core/runbook/dispatch.ts` · `call` (`RunbookAbsenceSignal`) | a walk refuses to continue on an absence and hands it through whole | mid-walk | a typed absence, never a guess | the precedent for "not sure" inside the library |
| the lens | separate package (agentfootprint-lens) | `FindingsBand`, `ReasoningLens`, `ProofMap` (`stands on` / `contingent` / `conflict` overlays, `unsupportedValues`), `CoverageBand`, `humanizeEvidence` | at the cursor | renders; laws: never infer, no verdict, omit-never-deny, no sentence of its own | the assessment row must satisfy those laws to be drawn; integrity findings, `middlewareDecisions` and `answerValidation` reports are invisible today |

**Three honest conclusions.**

- **Three of these already share one substrate.** The findings ledger's fact rows, the
  integrity checks and ContextFootprint use one `Assertion` shape and one `conflictsOf`
  (docs/design/2026-09-findings-ledger.md records it as RESOLVED, "no new dependency"). The
  assessment row joins that substrate; it does not add a fourth.
- **Two mechanisms are already typed assertions over the record — and neither corrects.**
  `.answerValidation()` withholds, `.claims()` records. The earlier claim to the owner that
  "five mechanisms were built separately and one declared form replaces them" was wrong
  (§ 12, C3). The token gate is a separate substrate that produces reasons; the shadow is the
  app's; the count omitted the two that already fit.
- **"One form" is one ROW, not one mechanism.** The moments differ (pre-call, dispatch,
  would-be-final), the readers differ (tokens, typed answer, the record), and two of them state
  opposite laws by design (the gate corrects once; the claim seam never re-routes). So the
  design is a per-rule choice of *moment × reader × consequence* that all writes into ONE row
  type the lens prints — the table in § 5.6.

**Three states of "not sure" the library already keeps apart, and this page keeps apart:**
CONFLICT (two readings disagree — a `ConflictRow`), ABSENCE (no reading at all — `absent()`,
`empty-lookup`), STALE (grounded only in a prior turn — `prior-turn-evidence`, off by default in
the host). The owner's "no idea" is almost always ABSENCE, which `conflictsOf` cannot express
("An empty result means no conflict was found … It does not mean that evidence was
retrieved") — so the assessment needs absence rows as first-class reasons, not only conflicts.

---

## 5. The primitives

Six things, each small. None adds a stage, a branch or a scope key an unarmed run can see.

### 5.1 Typed values with provenance

Every row a verdict reads carries WHO put the value on the record:

```ts
type Provenance =
  | 'claimed'   // the caller said so: the HTTP body, a form field — pre-authentication
  | 'answered'  // a PERSON supplied it to a declared InputField through a pause the run raised
                //   (InputResponseResult, origins[field] === 'response'); admitted by the field's
                //   declared enum/type, so app-validated — but a person's word, not app code's
  | 'given'     // app code decided it: a grounder's output, a resolver verdict, a declaration
  | 'observed'  // a tool returned it: a result, an absent()/coverage() envelope, resultColumns
  | 'checked'   // ONE owner: an AnswerValidationReport { mode: 'enforce', status: 'passed' } for these bytes
  | 'judged';   // a model or classifier said it: _findings, score_skills, a JudgmentRow, prose
```

`answered` is round 3's addition (§ 15, R3-13): round 2 moved the person's values into the
paused tool's own `InputResponseResult` ("it contains inputs, not observations") and left them
with no tier, so the strength rule below could not be evaluated on the flagship's resume half.
The library already keeps the per-field vocabulary the tier maps: `core/inputRequest.ts` ·
`AwaitingInput.origins: 'declaration' | 'response'` — `'declaration'` is a value the tool
`supplied` (`given`), `'response'` is the person's (`answered`). A value declared `string` is
free text and is `answered` only in name; the ASPI guarantee (§ 7.1) holds for `enum` /
`number` / `boolean` fields.

**Every one already has a carrier; the type is what is missing.** `claimed` and `given` are the
ship-first page's capability 1 (`HostRequest.claimed` → `standingAgent({ ground })` → a frozen
`given` on every hook ctx). `observed` is every tool result and envelope. `checked` has exactly
ONE owner: `src/answer-validation/types.ts` · `AnswerValidationReport` with `mode: 'enforce'`,
`status: 'passed'`, `checked ≥ 1`, matched by `candidateDigest` to these bytes and resolved
through the run's artifact scope. NOT `src/core/agent/types.ts` · `AgentState.answerGuarantee`:
its `'checked'` value means the answer was generated as text and the OUTPUT SCHEMA parsed it
afterwards (`'instruct'`, the default) — a SHAPE fact its own doc separates from
`answerValidation`, written by `route.ts` · `recordAnswerGuarantee` from the enforcement alone,
before any host check runs. Reading it as a receipt would label every default-strategy schema
answer `checked` — the exact "unchecked number PRESENTED AS a checked result" § 6 exists to
prevent (§ 13, F5/F9/F12). `answerGuarantee` may sit on the row only as a separate `shape`
fact and is never read for provenance. `judged` is
`BasisRow` / `StandingRow` / `JudgmentRow` and every `score_skills` fit. Three library places
already spell the first three tiers in their own words — `HostRequest.decision` ("the port
never interprets it"), `ExternalGround.source` ("the audit handle that travels onto the
record"), `answerValidation` `evidenceRefs` (must resolve through the run's artifact scope) —
and the design reuses those, it does not invent a fourth spelling.

Where the type lands: on the library's own assertion rows (`src/integrity/assertion/`, which
already wraps ContextFootprint's `Assertion` with the legacy key strategy). ContextFootprint's
`provenance` stays a string (a separate package, and the host imports it directly); the typed
field sits BESIDE it on the library's row. **The key strategy, read correctly (§ 13, F8).** Both
copies ship the SAME tuple default (`assertionKey`: "Tuple identity avoids collisions when a
subject or predicate contains a delimiter"; the 0.1.0 README already documents it), and
0.1.0 → 0.1.1 differs only in `renderValue` (`Object.create(null)`, the `__proto__`
correction) — it is not a key-strategy change. It is the LIBRARY's own wrapper that opts into the
legacy delimiter key on every comparison (`src/integrity/assertion/types.ts` · `assertionKey`
builds a NUL-delimited `kind · id · predicate · epoch` string and "retains its existing
collision behavior"; `conflicts.ts` · `conflictsOf` passes it as the strategy — findings fact
rows and integrity checks included), while the host compares on the default
(`be-server/vmInventoryFacts.ts` · `conflictsOf(assertions)`, `metrics/server/answer-facts.mjs`).
The pin to decide is (a) whether the library keeps its legacy key once rows from both sides are
joined — the legacy key collides on embedded delimiters, and the README says so — and (b) the
host taking the 0.1.1 `__proto__` fix. The side that changes is the library's wrapper, not the
host's copy.

**Two rules the type makes statable.**

- **Minimum strength.** A verdict may demand it: a subject kind used to SELECT a skill or key a
  collector must be `given`, `observed` or `answered` (a `judged` placement never selects — the
  host's own law, "a guess never decides"; `answered` is admitted for keying a collector ONLY
  when the field was a declared `enum` over the subject's `candidateKinds ∪ 'not-in-this-
  estate'`, the app's own admission of the answer set — a `string` answer places nothing);
  a value the answer LABELS checked must be `checked`; a `claimed` value never reaches a hook
  (capability 1's law 4, as a type). Whether `answered` ranks above or below `given` when the
  two disagree on one predicate is open question 19; until ruled, a disagreement is a
  `ConflictRow` and the assessment is `unknown` (no silent winner).
- **No silent winner.** When two `asserted` readings disagree across strata, the conflict is
  FILED (a `ConflictRow` with both provenances) and the assessment is `unknown` — unless a rule
  DECLARED a winner for that predicate (`given` beats `judged` for selection; `checked` beats
  `observed` for a labelled number). The lattice is declared per predicate, never assumed
  total; TMS resolution and Denning's lattice are the shape (§ 7), the declaration is the
  app's. An UNKNOWN is not a reading: a resolver's `unresolved` verdict is `{ kind: 'unknown',
  reason: rule }` in `Claim<T>` terms and never participates (ContextFootprint
  `assertion.d.ts`: it "can neither corroborate nor contradict"), so an `observed` placement
  found later by a declared placing lookup stands beside it without a conflict and without a
  winner (§ 5.5, rule order).

### 5.2 Assertion declarations — what the app declares, so the untyped side becomes typed

Each declaration turns one row of the § 2 table from prose into a comparable value. Every one
is a Map declaration; none is a prompt.

| declaration | where | makes typed | closes |
|---|---|---|---|
| `.claims({ field: { entity, field } })` over `.outputSchema()` | exists — `AgentBuilder.ts` · `claims()`; `src/integrity/unsupported-claim/` | the answer's FACT claims | a false claim from real values |
| an EXISTENCE claim class on `.claims()` — `{ subject, exists: boolean }` | new, on the same contract | "not in the estate", "decommissioned", "no clusters collected" | grey area B: joined to an `absent()` envelope's `notChecked: 'whether X exists'` |
| an ACTION claim class — `{ action: 'ran' \| 'read', tool }` whose witness is a tool-call row | new, on the same algebra | "I checked the inventory", "I ran the analysis" | the OverclaimBench criterion (§ 7): a report of work the transcript shows was not done |
| a COVERAGE claim — `{ window, sources }` | new | "over the last 6 hours" | grey area G: envelope `checked` vs stated window |
| tool parameter kinds — `defineTool({ …, argumentKinds: { host: 'esxi-host', array_id: 'powermax-array', cluster: 'name-fragment' } })` (name open) | new, STEP 3 (pulled forward from step 4 in round 3, § 15, R3-5 / R3-6: the two deny arms' "keyed on" predicate needs it — without it "keyed on" is a string match of the span against every argument value, which would deny a `name-fragment` slot after the person has answered); `core/tools.ts` · `defineTool` must copy it or it is silently dropped (it already copies `resultKind` / `resultColumns` / `argumentsFrom` the same way); on the host it must ALSO ride the generated catalog's `_meta.agentfootprint` and `src/catalogTools.ts` · `Extras` (today a `Pick` of `resultKind \| argumentsFrom \| resultCeiling`), because `catalogTool` refuses any TS-side override of metadata (§ 15, R3-P5) | the parameter's operand; `'name-fragment'` is the one kind that NEVER mismatches (a lookup slot takes any name) | grey area C: an array name in a host slot is a pre-dispatch conflict with the `given` placement; grey area A: "keyed on an unplaced subject" = an argument whose declared kind ∈ the subject's `candidateKinds` holds the subject's span |
| placing lookups — `defineTool({ …, resolves: ['vm', 'powerscale-cluster', …] })` (name open) | new; copied by `defineTool` like the row above (and through the catalog `_meta` / `Extras` on the host) | which tools PLACE a subject from a bare name — and what a HIT and a MISS look like to the library, both of which the tool must DECLARE (§ 15, R3-3 / R3-12): a miss is an `absent()` envelope (`af_absent: true`, `checked` non-empty — the ONLY shape `coverage/absent.ts` · `readAbsence` reads); a hit is `semantic({ facts: [{ entity, … }] })` with exactly ONE fact for the subject (the typed row-with-entity shape `lib/semantics/types.ts` · `SemanticFact` requires) or a TOP-LEVEL array of rows under `resultColumns` (`readRowset` reads a top-level array only; a `{ total, vms }` wrapper is invisible to it); N ≥ 2 matching rows (the host's `vm` query is `VM = ? OR VM LIKE %vm%`, a substring match) is `semantic({ facts, clarify })`, never a placement; a result in any OTHER shape is "ran, undeclared" — `not-applicable`, silent, a lens line | grey area A: the before-tool rule fires on COLLECTORS keyed on an unplaced name — while candidate lookups remain (naming them) — never on the lookups whose job is to place it, and never on a state the record reaches through an undeclared shape (§ 5.5, rule order; § 13, F6; § 14, R1/R8; § 15, R3-1) |
| the subject placement — the algebra the page already chose, through a declared port: the `placements` provider (on the `externalGrounds` pattern, `src/core/agent/types.ts` · `ExternalGroundsProvider`: a zero-arg synchronous provider the app adapts to) yields ContextFootprint `Assertion[]` — `{ subject: { kind: 'name', id: 'SHQZXPLAP941' }, predicate: 'kind', value: known('powermax-array', rule) \| unknown(rule), stratum, provenance: 'given:estate-naming-rule' }` plus one multi-valued predicate `'candidateKinds'` on an unplaced subject — through the library's own wrapper (`src/integrity/assertion/types.ts`, which re-exports `Assertion`, `participates`, `sameSubject`) with § 5.1's typed provenance BESIDE the string, the way the findings fact rows already ride it | new (§ 14, R11), re-shaped in round 3 (§ 15, R3-14): round 2 minted a third app-given shape (`SubjectPlacement { subject, status, kind?, rule?, candidateKinds? }`) beside `ExternalGround` and `Assertion`, with its own comparison rules — "an unplaced row never participates", "no silent winner" — that the vendored `assertion.d.ts` already gives for free (`value` "may be a plain value or a `Claim<T>`; a non-`known` Claim never participates"; `participates()`; `conflictsOf`). The type is dropped; the port stays. NOT read out of `given`: capability 1 defines `AgentRunOptions.given?: unknown` as opaque, and the host's subject shape (`{ span, kind, status, rule, origin }`, `be-server/routing.ts` · `subjectEvidenceCarry`) is business logic the app ADAPTS to the assertion, never a shape the library parses. `grep` of `src/` finds no placement type today, and none is added | the resolver's verdict as assertions the library owns: a placed subject is `known(kind, rule)` under `given`; an unplaced one is `unknown(rule)` — it never participates — with `candidateKinds` as its own declared multi-valued predicate (the host's `shHost` rule text: "an application server"); a placement found later by a declared lookup is a second assertion on the same key under `observed`, a person's answer a third under `answered` (§ 5.5, settlement); a `given` vs `observed` DISAGREEMENT is a `ConflictRow` with both provenances (§ 5.1) | grey area A: the dispatch moment reads the assertions, `resolves` and `argumentKinds` and joins them; `subject-unresolved` = `!participates(kind)` after the candidate lookups; nothing parses app data. The rows are RECORDED once, at the moment the provider is read (`agentfootprint.placements.declared`, name open — § 15, R3-10: on the `externalGrounds` precedent only EXCUSALS are filed, never the grounds, so without this event the "placement row" every deny quotes would be no row) |
| skill `subjects` / `excludes` with the verbatim NOT sentence | exists in the host (`src/routing/declarations.ts`) | declared incompatibility | grey area F: consulted at `read_skill` admission as a correction, not served as advice |
| `absent()` / `coverage()` envelopes on every empty result | exists — `src/core/agent/coverage/`. On the host the envelope the library reads (`af_absent: true`) is minted by the PYTHON side: `py-tools/server.py` · `af_absent()` is called at ~57 sites — but NOT in `real_rvtools_get_vms`, `real_pmax_get_inventory`, `real_pmax_get_sg_perf` or `real_vrops_get_vm_perf` (the case lookups), only `real_pscale_cluster_inventory` among them (via `_ps_absent_cluster`). The TS-side `absent(` the earlier text counted in four files is `src/data.ts` · `absent` → `MockAbsence { not_found: true, count: 0, query, mock_data_covers, note }` — the offline mock's own shape, NOT the library's; `coverage(` is called in none (§ 15, R3-P2 / R3-P3) | "I looked here"; "existence not checked"; "try instead" — the first typed, the last two PROSE today | grey areas B and C: a bare `{ count: 0 }` / `{ total: 0 }` wrapper — and the mock's `not_found` shape — is not-applicable to every check |
| a typed coverage vocabulary — `tryInstead: { tool: string; why?: string }` (object form; the string stays for prose) and `notChecked: [{ kind: 'existence' \| 'window' \| …, subject?, why }]` on `absent()` / `coverage()`; `ToolAbsentPayload` carries `tryInstead` | new — `coverage/types.ts` · `AbsenceDeclaration`, validated at `absent()` time like the rest; `events/payloads.ts` · `ToolAbsentPayload` (today: `lookedFor`, `checked`, `notChecked`, `cannotCover` and nothing else — `try_instead` survives only inside the tool result in history) | "try instead" as a TOOL NAME; "existence not checked" as a KIND | grey area B: `source-not-consulted` and `existence-not-checked` become joins over typed fields; until then both are prose and file nothing (§ 13, F4/F15) |
| `argumentsFrom` and `resultColumns` on lookup tools | exist — `src/integrity/empty-lookup/`, `column-types/` | a grounded key with an empty result; a column's type | F4: arming, not building |
| `expect` on the basis row | exists — `_findings.basis.expect` | what the model expected BEFORE the result | grey area D: `expectation-missed` |
| the answer's own declared standing — `_findings.answer: { standing: 'fact' \| 'open', settles? }`, the SAME `Standing` vocabulary the per-result rows use (`PreviousStanding.settles` already spells "not sure, and this would settle it") — never a second model vocabulary | small extension of `FindingsDeclaration` (the reserved `_findings` ride-along under `outputSchema`, `reserved.ts` · `RESERVED_ANSWER_KEY`) | the model's own "fact / open" on the whole answer as a `judged` assertion | consequence 5 of § 3: kept, compared, never deciding |

### 5.3 The reason vocabulary

A closed union. Each member names the ROW it is read from; a reason with no row is a defect,
not a sentence. The lens prints the library's sentence for each, verbatim.

| reason | read from | witness | grey area |
|---|---|---|---|
| `subject-unresolved` | an `unknown(rule)` placement assertion (§ 5.2 `placements` port) for a span the question treats as its subject, AND no participating placement on the same key from any other provenance: an `observed` one from a declared placing lookup's DECLARED hit (§ 5.2 `resolves` — a bare-wrapper hit is "ran, undeclared" and extinguishes nothing, § 15, R3-3), or an `answered` one derived by the fold from the resume row of a `requestInput` that carried `absence` and whose `kind` field was a declared enum (§ 5.5, settlement; § 15, R3-5) — the first participating one extinguishes it; `'not-in-this-estate'` answered is a participating value that CLOSES the subject (nothing may be keyed on it; the reply is labelled from that row). NEVER on an empty placement list: round 1's "(or no subject)" arm fired on the ABSENCE of a resolver row, which has no span, no rule and no digest to witness — a clause composed from no row, the thing § 3 consequence 4 forbids — and it labelled every question with no identifier-shaped span (a fleet question, "is 006 slow", "is epic-cache-07 slow", all `subjects: []` on the record) "no idea → ask". An empty list is `not-applicable` (§ 14, R3) | the placement row (rule, candidate kinds); the candidate lookups' `absent()` envelopes | A |
| `source-not-consulted` | an `absent()` envelope's TYPED `tryInstead.tool` (§ 5.2) with no call in this run's `toolResults` — never the prose string: a tool name found inside prose is an inference. NO carrier today; a lens-printed coverage line until the field ships | the envelope's `toolCallId`, `tryInstead.tool` | B (unknown-id: `pscale_cluster_inventory` never ran) |
| `existence-not-checked` | an EXISTENCE claim `exists: false` joined to an envelope `notChecked[].kind === 'existence'` (§ 5.2) — never to the prose `what`. NO carrier today on either side | claim + envelope | B |
| `lookup-empty` | `empty-lookup` advisory rows; carries `count: { empty, total }` for the run | the rows' `toolCallId`s | F4 ("N of N") |
| `zero-not-absence` | an `absent()` / `coverage()` envelope, or a TOP-LEVEL array of rows with zero rows (the only rowset `readLookupResult` / `readRowset` read), on a call whose argument kind mismatched or whose subject was unplaced. NOT `resultKind`: round 2 wrote "a `resultKind` / `resultColumns`-declared rowset" and said the host declares neither; both halves were wrong — the host declares `resultKind: 'dataset/rows'` on 82 of 90 catalog tools, and `resultKind` is the ARTIFACT KIND an oversized result is minted under for `wants` matching (`core/tools.ts` · `Tool.resultKind`), which names no key that holds the rows and counts nothing (§ 15, R3-P1). A bare `{ count: 0 }` / `{ total: 0 }` wrapper is an UNDECLARED shape and is `not-applicable` — as `empty-lookup` treats it ("a bespoke `{ rows: [...] }` wrapper" is its own example), and as `absent.ts`'s header says: a convention cannot set a status | envelope or top-level rowset + the kind row | C |
| `argument-kind-mismatch` | `argumentKinds` vs a participating placement (`given` / `observed` / `answered`), before dispatch; the declaration is step 3 (§ 5.2), the pre-dispatch CORRECTION that uses it is step 4 | the call | C |
| `tool-refused` | a `deny`, `failure`, `invalid` or `denied` envelope on a call this answer rests on | `middlewareDecisions` row / the envelope | F2 |
| `sources-conflict` | a `ConflictRow` (`conflictsOf` over `fact` rows or app data assertions) | the witnesses | data-side, F5 |
| `value-unsupported` | `scope.unsupportedValues` | the values | the gate |
| `value-survived-revision` | `evidence_checked { action: 'flagged', afterRevision: true }` | the values | D |
| `value-contingent` | `ContingentRow` | carriers | ledger |
| `value-unchecked` | a value the answer labels checked with no passed `AnswerValidationReport` (`mode: 'enforce'`, `status: 'passed'`, this turn's `candidateDigest`) resolvable through the artifact scope — `answerGuarantee` is never consulted (§ 5.1) | the label, the missing receipt | § 6 |
| `claim-contradicted` | `unsupported-claim` `checked-fail` | claim + settled fact | claim seam |
| `action-unwitnessed` | an ACTION claim with no tool-call row | the claim | § 7 |
| `coverage-narrower-than-stated` | a COVERAGE claim vs envelope `checked` | both | G |
| `expectation-missed` | `BasisRow.expect: 'high'` and the result `status: 'absent'` / empty | `toolCallId` | D |
| `skill-declared-incompatible` | the app's supported-negative verdict (`given`) vs a `judged` fit | both | F |
| `basis-stale` | `prior-turn-evidence` advisory | the values | STALE |
| `check-unreachable` | `Disposition: 'unreachable'` rows | the check id | integrity |

The three states of § 4 map onto it: CONFLICT = `sources-conflict`, `claim-contradicted`,
`skill-declared-incompatible`; ABSENCE = `subject-unresolved`, `source-not-consulted`,
`existence-not-checked`, `lookup-empty`, `zero-not-absence`, `check-unreachable`; STALE =
`basis-stale`.

**Two reasons have no typed carrier today** (§ 13, F4/F15): `source-not-consulted` and
`existence-not-checked` both need § 5.2's coverage vocabulary — `tryInstead` is a free string
("Widen the window, or check pscale_cluster_inventory for the collected cluster names."),
`notChecked[].what` is a free string ("whether the cluster exists at all"), and the
`tools.absent` event carries no `tryInstead` at all. Until the typed fields ship they are
lens-printed coverage lines over the envelope's own words, never reasons that decide the
assessment; the earlier draft's "witness: the tool name" named a value the record does not
hold.

### 5.4 Moments

| moment | what the fold can read there | verbs that exist | verbs this page adds |
|---|---|---|---|
| the door, before a run (`standingAgent` identity / admission / `ground`) | `claimed` → `given`; the resolver's verdict — but NOT the message: `admission` sees `{ identity?, sessionId?, recentSpend }` only | typed refusal (`ERR_…` codes); `allow` / `queue` / `refuse`, "no fourth" | none in the library (§ 5.5 form 2: a pre-run ask is app work on the wire's `PendingAsk`, or an owner ruling) |
| before-tool (`onToolCall`) | the whole batch (in `ctx.history` — `ToolCallContext` carries `toolName`, `toolSource?`, `toolCallId`, `iteration`, `args`, `history`, `identity?`, `signal?`), the placement assertions, `argumentKinds`, the tool's declaration (`resolves`), every prior result in this turn (the candidate lookups' envelopes, in `history`) | `deny` (correction), `allow(args, why)`, `ask` (decision — `AskPayload { question, detail?, component? }`, no values) | none. Round 1 added an `ask` carrying an `inputRequest` here (form 1); it is dropped — the pause it needed already exists inside the tool (§ 5.5; § 14, R10). What this page adds here is ONE library-owned evaluator with two consumers (§ 15, R3-10): a pure fold `placementVerdict(call, placements, resolves, argumentKinds, history)` (name open) → `{ kind: 'pre-lookup' \| 'remaining-lookups' \| 'placed' \| 'last-candidate' \| 'not-applicable', witnesses }`, a built-in before-tool middleware factory that calls it and denies with the library's sentence on the first two kinds, carrying the witnesses on a typed `because` (§ 5.6), and — for the tool moment — the `last-candidate` fact handed to the placing lookup on its execution context (§ 5.5). The Route fold reads the SAME function |
| after-tool (`onToolResult`) | the result, its envelope, the `expect` filed before it, the app's verdict | `allow(result, why)` (annotate; both versions committed), `deny` | — (no `ask`, by code and by law — `ToolResultOutcome = AllowOutcome \| DenyOutcome`; § 14, R2) |
| Route, before the answer | the typed answer, `unsupportedValues`, `ContingentRow`s, claim seam, dispositions, `coverageDeclared`, `toolResults`, the placement assertions (recorded once, § 5.2), any `input_received` result of a `requestInput` that carried `absence` (the `answered` placement, § 5.5), and — in the OUTERMOST wrapper only — this turn's `answerValidation` report | `evidence-recheck` (once), `.claims()` (advisory), `.answerValidation()` (withhold), message `deny` | the assessment FOLD writes its row here, after `withAnswerValidation` (§ 5.6; a label, no branch) |
| turn end | everything above | `turn_end` totals | the row rides the record |

No sixth moment. The `LOOP_MOMENTS` completeness lock is deliberate and stays. The tool's own
`execute` is not a moment of its own and needs none: `requestInput` raised there rides the tool
boundary's pause (`core/pause.ts` · `requestInput` = `pauseHere({ question, inputRequest })`
— a thrown `PauseRequest`; `stages/toolCalls.ts` catches it in the per-call loop, stamps
`awaitingInput` with the paused call's `origin.toolCallId` and RETURNS the checkpoint, so no
sibling runs and no before-tool moment follows in that iteration), the same door `checkIn` and
`askHuman` use — and it is where this page's ask is raised (§ 5.5). Two facts about that
branch that round 3 pinned (§ 15, R3-1 / R3-9): a tool that throws returns no value, so
`declareCoverage` (which files `tools.absent` / `coverage_declared` and appends
`scope.coverageDeclared`) never runs for it — the asking lookup's miss would leave no observed
row unless the pause branch files it; and the branch runs BEFORE the batch's remaining
siblings, which is the batch settlement's whole cause.

### 5.5 Verdicts — and the one new door-shaped thing, which is a pause, not a door

Four verbs, all existing except the last's payload:

- **Label.** The assessment row (§ 5.6). Never rewrites, never blocks. The answer ships with a
  row beside it that the lens prints and the host may carry to its reply (the reply half is
  "results out", on its own page — until then the host drains it as it drains `evidence`). A
  label changes the ROW, never the reply the model wrote — § 8.2 measures the two apart.
- **Correct.** A before-tool `deny(reason)` on a COLLECTOR keyed on an unplaced subject — an
  argument whose declared kind (`argumentKinds`, step 3) is in the subject's `candidateKinds`
  and holds the subject's span; a `name-fragment` slot never counts — in two arms, each a
  sentence composed from rows that exist at that moment, evaluated by ONE library fold
  (`placementVerdict`, § 5.4) and denied by the built-in middleware that reads it, with the
  witnesses on a typed `because` (§ 15, R3-1 / R3-2 / R3-6 / R3-10): *pre-lookup* — no
  candidate lookup has run: "SHQZXPLAP941 is unplaced (rule: an SH… machine name with no estate
  prefix — an application server). No lookup that could place it has run. The lookups declared
  for what it could be: rvtools_get_vms (vm), rvtools_get_host_details (esxi-host). Run one of
  those first." (the second lookup is an illustration — which tools carry `resolves` for which
  kinds is the host's step-3 declaration, not this page's) — two clauses, the rule quoted from
  the placement assertion and the lookups a join of `resolves` over its `candidateKinds`, and
  NO coverage clause: round 2's third clause ("existence was
  not checked by anything yet; the collectors you proposed read collected samples, not
  whether it exists") had no row — the collectors are denied and never run, so no envelope
  exists, and no `Tool` field declares coverage statically (§ 15, R3-2). Whether a
  definition-time coverage declaration should exist so that clause can return is open question
  18, not a thing this step composes; *remaining-lookups* — some candidate lookups ran empty
  and at least one has not run: "SHQZXPLAP941 is still unplaced: rvtools_get_vms (vm) found
  nothing (absent: 'a VM by that name in the RVTools inventory'; not checked: 'whether it
  exists elsewhere'). Not yet run: rvtools_get_host_details (esxi-host). Run it before any
  collector." — the envelopes quoted verbatim (`notChecked[].what`, the rows that DO exist
  now), the remaining lookups the same join minus the calls in this turn. Round 2's
  *post-lookup* arm ("Nothing places it; ask the person which system it is") is struck: by the
  page's own rule order the LAST candidate lookup's miss raises `requestInput`, which throws
  out of `execute` and returns the checkpoint — so a before-tool moment after every candidate
  lookup came back empty NEVER exists, and the arm could fire only in the middle state, where
  "ask the person" is false and steers the model to the premature ask the bench scores a miss
  (§ 15, R3-1). "The person" appears in exactly one place: the app-composed `question` of the
  last lookup's `requestInput`. The all-empty state has no before-tool sentence because it
  pauses. Both arms are silent — `not-applicable`, a lens line — when a candidate lookup ran
  and returned an UNDECLARED shape (§ 5.2 `resolves`, § 15, R3-3), and both stop firing the
  moment a participating placement exists on the key, including the person's `answered` one
  (§ 15, R3-5). Round 1's sentence ("no result names it; the cluster inventory found no name
  matching it") was a pure absence statement with no coverage boundary — the exact shape the
  recorded model turned into "not in the collected estate … decommissioned", and the shape the
  library's own recovery frame invites (`gate.ts` · `buildEvidenceCorrection`: "an honest
  'that was not collected' is a correct answer" — grey area B's wording; § 10 change 7
  reconciles it); the remaining-lookups arm quotes the boundary from envelopes, and the
  pre-lookup arm states no absence at all. Also: an after-tool `allow(result, why)` that
  annotates a declared empty rowset with "on an unplaced subject, zero is not absence";
  `validateToolArgs` for shapes; the `read_skill` admission refusal with the skill's NOT
  sentence. All reach the model as a tool result and the loop continues (law 2 of the
  ship-first page). **What a deny does not do:**
  nothing after it constrains the next move — lookup, prose ask, or another guess — and no
  recorded turn shows Haiku recovering honestly from a deny (the host's precedent
  `tests/be-server-vm-analysis-correction.test.ts` scripts the model; the retained records hold
  zero `outcome: 'deny'` rows). So the deny's effect on the REPLY is a bench column
  (post-deny recovery: lookup / ask / guess, § 8.2), never an assumption.
- **Withhold.** Existing and unchanged: `.answerValidation()` enforce, message `deny`. Used only
  where the PERSON asked for a checked thing (§ 6).
- **Ask, with the reason and typed fields.** Today the model's only route to asking is prose
  under the `guard` revision, served once, request-only, and the library states it "does not
  … guarantee that the model will ask a useful question" (`src/core/agent/evidence/README.md`);
  a clarifying reply is then delivered as an ordinary final answer that the gate calls
  `grounded` (no data tokens) and the UI cannot tell from an answer. Round 1 proposed two
  forms; round 2 found the first was a second owner of a door that exists and fired at the
  wrong moment, and the second was never a library door (§ 14, R10 / R4; § 13, F13). What
  stands:
  1. **At the tool moment, on the door that exists — `requestInput` from the placing lookup
     that found nothing.** `core/pause.ts` · `requestInput(declaration)` IS "a pause resumed
     with typed values": raised from inside a tool's `execute`, validated by
     `InputRequestDeclaration` (fields with `enum` / `number` / `boolean` / `string`),
     stamped with the paused call's `origin.toolCallId` (`stages/toolCalls.ts`), rendered and
     persisted by the host as `RunnerPauseOutcome.awaitingInput`, and on resume the person's
     validated values reach the MODEL as that tool's own `InputResponseResult` (`Agent.ts` ·
     `resume`: `status: 'input_received', requestId, values, origins, origin` — "contains
     inputs, not observations"). It fires AT the lookup that came back empty — which is where
     the honest sequence reaches an ask — not at a before-tool moment that exists only if the
     model proposes a further tool. Round 1's form 1 (an `AskPayload.inputRequest` at
     before-tool, resumed with values, settled by the asking link's own verdict) needed four
     reader changes, a batch fix and capability 1's resume door to define a settlement that
     `requestInput` already has; and on the flagship record it was unreachable: after the empty
     lookup the honest model asks in prose (no tool call, no pause), while only a model
     proposing a SECOND collector on the still-unplaced name reached the before-tool ask — the
     door fired on the guessing model and never on the honest one. Form 1 is DROPPED; `AskPayload`
     is untouched (§ 10). **What the library adds here is three things, not one field (§ 15,
     R3-7 / R3-8 / R3-9):**
     - *The fact the tool raises on.* `ToolExecutionContext` gains a read-only
       `placement?: { subject: string; verdict: 'last-candidate' | 'candidate' | 'not-a-candidate' }`
       (name open) for a tool declared with `resolves`, computed by the SAME `placementVerdict`
       fold the before-tool middleware reads (§ 5.4): "last" means every other lookup declared
       for the subject's `candidateKinds` has already returned in this turn, counting a sibling
       LATER in the same batch as not yet run (siblings run sequentially in the per-call loop,
       so the raise falls on the batch's final candidate). The tool's rule is then one line —
       on its own miss, `requestInput` when the fact says last, `return absent(...)` otherwise —
       over a library-computed fact, the way `checkIn` / `askHuman` already raise on facts the
       library admits. Round 2 wrote "the app knows which lookup is last because the app owns
       the resolver and its candidate kinds": which lookups are CANDIDATES is the app's
       declaration, but which one is LAST is a run fact (the model's call order), and
       `ToolExecutionContext` exposes no history and no prior results (`toolCallId`,
       `iteration`, `signal`, `credentials`, `hasCredentials`, `artifacts`, `hasArtifacts`,
       `wanted?`, `credential?`, `progress`, `runId?`, `sessionId?`, `identity?`); the host
       could have answered it only through per-request ambient state (`be-server/routing.ts`
       binds `activeInput` per request in a closure; the bindings are module-level
       `catalogTool(...)` calls) — the `AsyncLocalStorage` reach the declared-control page
       names as the problem. A `ToolExecutionContext.priorCalls` view (this turn's
       `{ toolName, status }` rows) was the smaller alternative and is NOT taken: the tool
       would re-derive the placements × `resolves` join the library already folds — a second
       evaluator of one fact, Fold law 1 (§ 15, R3-10).
     - *The typed field, EARNED by a reader.* `InputRequestDeclaration.absence?:
       AbsenceDeclaration` (the same shape `coverage/types.ts` · `AbsenceDeclaration`
       validates at `absent()` time — `what`, `checked`, `notChecked?`, `cannotCover?`,
       `tryInstead?`; the recorded row spells `what` as `lookedFor`). The declaration ALREADY
       has an opaque `context?` slot that would carry an absence today, validated and handed
       back to the model on resume (§ 4) — round 3 asked what a named field buys that
       `context` does not, and the answer is the next item: a library reader that finds the
       absence BY NAME. Without that reader the field is documentation and `context` is the
       honest recipe; with it, `context` cannot serve, because a reader that parsed app JSON
       out of an opaque slot would infer a shape it never declared. `validateInputDeclaration`
       refuses unknown keys today (`id`, `question`, `fields`, `supplied`, `context` only), so
       the field is an allow-list change there as well. The ask then rides
       `agentfootprint.pause.request` unchanged (its `questionPayload` is the whole
       `pauseData`, § 4).
     - *The reader: the miss is FILED before the pause.* `stages/toolCalls.ts`'s pause branch,
       on an `inputRequest` that carries `absence`, runs the same `declareCoverage` over it
       that a RETURNED `absent()` gets — `agentfootprint.tools.absent`, `scope.coverageDeclared`,
       and the `empty-lookup` write seam when the call is grounded — BEFORE the checkpoint is
       returned. Round 2 displaced the asking lookup's miss from the record: a tool that throws
       `requestInput` returns no value, `declareCoverage` runs only on the returned value, and
       on resume the call's result row is the person's values — so "rvtools_get_vms found
       nothing", the flagship reason's own witness, survived only as a field on the pause and
       reached neither the `CoverageBand` nor `.limitsTravelWithTheAnswer()` (§ 15, R3-9). The
       reason is then a row twice over: the observed absence on the record, and the same
       absence on the ask.

     **The settlement — who consumes the values.** Today's, unchanged on the wire: the
     person's values are the paused tool's own result (`InputResponseResult`, built by
     `Agent.ts` · `resume` as `{ status: 'input_received', requestId, values, origins, origin,
     context? }`), and the model reads them on the resumed iteration and decides what to call
     next — a VM lookup keyed on the name it was given, a collector keyed on the kind it was
     given, or an answer. No middleware writes a tool's answer (§ 10's kept law: the tool that
     asked is the tool that "returns"); nothing free-text enters the model's context unless a
     field is declared `string`, which the declaration says. **And the answer PLACES the
     subject (§ 15, R3-5 / R3-13):** round 2 left the resume half undefined — only a declared
     lookup's `observed` hit extinguished `subject-unresolved`, the `placements` provider is a
     zero-arg function consulted from the app's own state, and nothing re-read the pause
     answer into it; so after the person answered "a storage client of SHISOLPLPAP006", the
     honest next call (`pscale_client_activity { cluster, client: 'SHQZXPLAP941' }`) met the
     deny arms again on a span still unplaced, and the sentence told the model to ask again.
     Now the FOLD derives the placement from the record, not the provider: an
     `input_received` result whose request carried `absence` and whose `kind` field was a
     declared `enum` over `candidateKinds ∪ 'not-in-this-estate'` is a placement assertion
     on the subject's key under `answered` provenance — `known(kind, 'answered:<requestId>')`
     for a kind, or the closing value `'not-in-this-estate'`; a `string` field yields nothing.
     Both deny arms and `subject-unresolved` read participation on the key, so an `answered`
     kind admits a collector keyed on that kind (`argumentKinds` ∈ the answered kind) and
     `'not-in-this-estate'` admits none and labels the reply from that row. No provider
     re-read is needed and none is specified — the row is on the record
     (`agentfootprint.pause.resume.resumeInput` and the `role: 'tool'` result), and the fold
     reads the record. Round 1's settlement (values →
     `claimed` → `ground` → the resume door's `given` → the chain re-run from the asking link →
     that link's `allow` / `deny` as the only channel) and its four change sites
     (`pauseDemandsDecision`, `Agent.resume`, `RunnerBase.detectPause`, the middleware-ask
     resume path) are WITHDRAWN with form 1 (§ 14, R10). Capability 1 is therefore no longer a
     prerequisite of the ask path — nor of the placement reading, which has its own port
     (§ 5.2; § 14, R11); it stays REQUIRED where § 6 G1 needs it.

     **The batch settlement (§ 13, F2) — still needed, re-scoped.** On the flagship case the
     three collectors were ONE batch (`stream.tool_start … parallelCount: 3`,
     `iteration_end.toolCallCount: 3`; C and D batched three as well). ANY pause raised from
     inside the per-call loop — a middleware `ask`, `checkIn`, `askHuman`, and `requestInput`
     thrown by a placing lookup that a model batched with collectors — leaves the siblings
     after the paused call un-dispatched; the resume settles exactly one call
     (`toolCallCount: 1`) and returns; the next request carries an assistant turn with N
     `tool_use` blocks and one `tool_result` — `AnthropicProvider` builds results only from
     `role: 'tool'` messages and synthesizes none, and the window layer names the shape
     (`'unresolved-tool-call'`) without filling it. Pre-existing pause behaviour that this
     page's ask meets on its first case whenever the model batches the lookup. The
     library-correct fix, a named change: every resume path settles the paused call's
     un-dispatched siblings with the library's own fixed sentence ("not executed on that call —
     the batch paused before it; propose it again if still needed"; the `askPolicy: 'refuse'`
     sentence in `toolCalls.ts` is the precedent), pinned by a test over a three-call batch
     whose middle call raises `requestInput`. Until it ships, an agent that arms this runs its
     provider with `createAnthropic({ parallelToolCalls: false })` (the host does so in
     `be-server/metricsProvider.ts` today and NOT for its chat provider). Whether the siblings
     should instead be DISPATCHED on resume is open question 13.

     **Rule order — the candidate lookups first, the last one asks (§ 13, F6; § 14, R1 / R8).**
     A before-tool assertion keyed on an `unplaced` placement must not fire on the tools whose
     JOB is to place a name: the host's `pscale_cluster_inventory.cluster` ("cluster name or
     any fragment of one") and `rvtools_get_vms.vm` ("VM name as RVTools knows it — look it
     up") are what an unplaced subject should hit FIRST, and the bench labels lookup-then-ask
     correct (unknown-id-slow: `expected: 'clarify', lookupAllowed: true`, "a lookup that
     finds nothing and then asks is correct"). Round 1 left the trigger to the builder
     ("every declared placing lookup came back empty") and was silent on the state the record
     holds. Pinned now, in four clauses:
     - *Which lookups.* The rule is keyed on the SUBJECT's `candidateKinds` (from the
       placement row — the shape rule's own hint: `shHost` / `appHost` → a VM; a bare token
       → whatever the resolver declares for it) and on the placing lookups declared for THOSE
       kinds only (`resolves ∩ candidateKinds`). Not "every placing lookup in the catalog":
       the host has six or more across estates (`pscale_cluster_inventory`, `rvtools_get_vms`,
       `get_array_inventory`, `pmax_get_inventory`, `powerstore_get_inventory`,
       `vm_storage_map`), each admitted only under its owning skill with `read_skill` alone
       per switch (`be-server/routing.ts`: `collectors` = every skill's tools; "Select its
       owning skill with read_skill alone before requesting its evidence") — an "every" rule
       would cost a skill switch per estate, arm D's ten-iteration $0.34 shape; an "any" rule
       would ask after the PowerScale inventory while the VM inventory that places
       `epic-cache-07` never ran (the premature ask the bench scores a miss).
     - *Who switches skills, and what it costs.* The MODEL does, reading the pre-lookup or
       remaining-lookups deny that names the lookups (the host's own admission law:
       `read_skill` alone, then the lookup) — one iteration per candidate estate plus the
       lookup itself. Round 2 costed the flagship as "a one-candidate shape (`shHost` → VM),
       two iterations beyond arm A's three"; that was wrong (§ 15, R3-P4): `SUBJECT_SHAPES.
       shHost` "also matches every estate device name", so a residual SH… name that no estate
       rule placed is MULTI-candidate — a VM, an ESXi host or a physical storage client (arm
       E's own question) — and its candidate lookups sit under at least two skills. For the
       flagship that is up to two switches and two lookups beyond arm A's three, i.e. up to
       seven iterations before the ask; for a bare token with three candidate kinds up to six
       beyond. No actor in the library moves the cursor to a lookup (§ 3, the expressibility
       law); a cross-estate name lookup that collapses the switches to one call is app work
       the cost argues for, not a library item. § 8.4's cost hypothesis is re-derived from
       this, not from arm E's $0.048.
     - *When the ask fires.* At the LAST candidate lookup's miss, raised by that lookup
       (`requestInput` with `absence`) — on the library's `placement.verdict ===
       'last-candidate'` fact (form 1 above), never on the tool's own knowledge (§ 15, R3-7).
       Round 2 pinned "last" on the app ("the app knows which lookup is last because it owns
       the resolver") and on step 6's `tryInstead.tool` chain; neither could know: "last" is
       the model's call order, a run fact, and `tryInstead` is a static suggestion. A lookup
       whose fact says `'candidate'` returns `absent()` and nothing asks — the honest model
       runs the next one, the guessing model meets the remaining-lookups deny on its next
       collector, and a model that instead ANSWERS with candidates remaining meets no verb
       (no tool call, no moment) and is labelled at Route (`subject-unresolved`) and scored
       by hand — the recorded resolver-unknown arm A is exactly that turn (§ 15, R3-1).
       Neither "every" nor "any" is left to the builder: the law is "ask after the last
       candidate lookup", and the library decides which one that is.
     - *What counts as a miss.* Only an `absent()` envelope (`af_absent: true` with a
       non-empty `checked` — `readAbsence`'s one law) or a TOP-LEVEL array with zero rows
       (`readLookupResult`'s one law; § 5.3, `zero-not-absence`; § 13, F15). Round 2 wrote
       "a `resultKind` / `resultColumns`-declared empty rowset" and "the host declares
       NEITHER on any of its 90 catalog tools"; both were wrong (§ 15, R3-P1): 82 of the 90
       carry `resultKind: 'dataset/rows'` in `_meta.agentfootprint`, which `catalogTool`
       spreads into `defineTool` — and it changes nothing here, because `resultKind` is the
       artifact kind an oversized result is minted under for `wants`, not a statement of
       where the rows live; `resultColumns` is on 0 of 90, and would not help either while the
       rows sit under `vms` (`readRowset` reads a top-level array only). What IS true:
       `real_rvtools_get_vms` returns the bare `{ query, sorted_by, total, returned, vms }`
       wrapper on a miss (the record: `"total":0,"returned":0,"vms":[]`), `real_pmax_get_
       inventory` / `real_pmax_get_sg_perf` bare wrappers of their own, and only
       `real_pscale_cluster_inventory` among the case lookups mints `af_absent` (through
       `_ps_absent_cluster`; the helper itself is called at ~57 sites in `server.py`). So the
       rule can see nothing on the VM lookup until the host moves exactly the lookups
       declared for the measured cases to `af_absent()` in the PYTHON server (the backend the
       bench ran — the TS mock binding already returns a `MockAbsence`, which is not the
       library's envelope either, § 15, R3-P3), in step 3 itself, not in steps 4/6 after
       step 3 has been measured.
     - *What counts as a hit (§ 15, R3-3 / R3-12).* Only a DECLARED placement: `semantic({
       facts: [{ entity: 'epic-cache-07', … }] })` with exactly one fact for the subject, or
       a top-level array of rows under `resultColumns` with exactly one row naming it. A hit
       in the bare wrapper is "ran, undeclared": it extinguishes nothing, denies nothing, and
       is a lens line — so the resolver-unknown turn that looks up `epic-cache-07`, finds it
       and answers stays `subject-unresolved` (rendered "no idea → ask" on a correct answer,
       the mislabel F6 / R3 were meant to close) UNTIL the host declares the hit. N ≥ 2
       matching rows — the host's `vm` query is `VM = ? OR VM LIKE %vm%`, a substring match —
       is `semantic({ facts, clarify: { question, candidates } })`, the existing carrier for
       "several match, none chosen", never a placement. Step 3's app half declares BOTH sides
       on the measured lookups; a rule that read only the miss would label the bench's own
       `expected: 'answer'` case wrong by construction.
     An `observed` placement by a declared placing lookup's DECLARED hit — or an `answered`
     one derived from the resume row — is then the record's only participating reading (an
     `unknown(rule)` assertion never participated), so `subject-unresolved` is extinguished
     with no declared winner; a resolver that ever asserted a NEGATIVE placement would be a
     reading, and § 5.1's declared winner would apply. This is F1's door: on unknown-id-slow
     every model-led arm CALLED a collector first, so the pre-lookup deny is reached on every
     recorded model-led sequence.

     **What round 1 called the "zero-library-change alternative" is the design, and round 1
     misstated what it lacked (§ 14, R10).** It said the `requestInput` pause "is not on the
     record AS an ask with its reason" and needed a `clarify_asked` row. Read back:
     `RunnerBase.ts` · `emitPauseRequest` mirrors the WHOLE `pauseData` onto
     `agentfootprint.pause.request.questionPayload` — for a `requestInput` pause that is
     `{ toolCallId, toolName, question, awaitingInput }`, the `awaitingInput` carrying the
     question, the fields, the `requestId` and `origin.toolCallId` — and
     `agentfootprint.pause.resume.resumeInput` carries the answer. The pause IS on the record
     as an ask; a `clarify_asked` / `clarify_answered` pair would be a second row for one
     pause (§ 5.6 corrected). What it lacks is the REASON — the absence that prompted it — which
     is the one field above. That the question is app-composed is not a defect: the placing
     lookup knows what it looked for and where, and the library composes no question of its
     own (the Lens laws, § 10).
  2. **At the door, before any run — NOT a library door (§ 13, F3/F13).** The earlier draft gave
     `admission` an `{ ask }` answer. It cannot: `hosting/admission.ts` · `AdmissionContext` is
     `{ identity?, sessionId?, recentSpend }` — the hook never sees the message, its job is "WHO
     is asking … and what that person has spent", and its verdict union is closed by a stated
     law ("One decision, three answers, no fourth"); `AwaitingInput.origin.toolCallId` is
     REQUIRED, so a no-run ask has no shape to ride; and the message chain has no `ask` by the
     middleware header's law. Nor could the door say what the draft promised for alias-006: the
     shadow row holds `subjects: []`, `ask-facet` over `['powerstore', 'powerscale']` (product
     facets) and `candidates: ['powerstore', 'pscale-triage']` (skill ids); the two cluster names
     exist only behind `pscale_cluster_inventory` — a tool call, a run. So a pre-run typed ask is
     one of two things, neither on this page's build order: (a) APP work today — the host's
     deterministic router already answers with no run, and can return the wire's existing
     `PendingAsk` shape (`hosting/types.ts`: `awaitingInput?`, `question?`) with an app-minted
     `requestId`; the person's answer then arrives on the next request as `claimed` → `given`;
     or (b) a genuinely new pause at the `input` moment, which the middleware header forbids and
     therefore needs an OWNER RULING as its own page (open question 14). Either way
     `AwaitingInput.origin` needs a non-tool origin variant before a door-level ask can ride the
     typed slot. Round 1 then moved alias-006 to "form 1: an after-tool rule over the
     inventory's declared rowset, `|matches('006')| ≥ 2 ⇒ ask which`" — three errors in one
     sentence (§ 14, R2 / R5 / R13): form 1 was defined at before-tool; the after-tool moment
     has no `ask` (`ToolResultOutcome = AllowOutcome | DenyOutcome`; the middleware header:
     "There is no `ask` at the after-tool moment … the tool has ALREADY RUN"; § 10 keeps it);
     and the seed holds ONE cluster ending in 006, so the predicate is never true. alias-006 is
     re-mapped in § 2: the honest lookup result is a KNOWN placement plus a SyncIQ target of
     the same suffix; when a fragment DOES match N ≥ 2 rows the carrier is `semantic({ facts,
     clarify })` from the inventory tool (an existing shape, § 4) — or `requestInput` with the
     N names as `InputField.enum` options, the app's choice, raised from the tool. **The
     after-tool `ask` arm — the case brought, and RULED not needed for it (open question 15,
     closed on this page; § 15, R3-9).** The middleware header invites it ("bring a case that
     genuinely needs a human at the after-tool moment and the arm can be added, on the pause
     machinery that already exists"), and round 3 argued this design IS that case: raise the
     pause AFTER the lookup returned `absent()`, so the miss is on the record and a library
     fold owns the trigger. Both of those goods are secured WITHOUT the arm (form 1 above):
     the trigger fact (`last-candidate`) is decidable BEFORE the call — the candidate lookups
     declared for the subject minus those already returned this turn minus later batch
     siblings — so the library folds it at before-tool and hands it to the tool; and the miss
     is filed as observed by the pause branch's reader. What the arm would have cost is what
     decides against it: the tool has RETURNED, so one `tool_use` would need two results (the
     committed absence and the person's answer) — settleable only by holding the raw result on
     the checkpoint and committing an after-tool `allow({ ...absence, input_received }, why)`
     on resume (the one after-tool verb whose law is "both versions committed"), a fifth
     resume path in `toolCalls.ts`, a new `ToolResultOutcome` member, and a `pauseDemandsDecision`
     arm — a header-law change with four change sites, for a fact the before-tool fold already
     holds. The header's own objection ("a side effect that already happened cannot be
     prevented") does not apply to a read-only lookup, so the arm is NOT refused on that
     ground; it is not taken because nothing this case needs is on the far side of the result.
     What would reopen it: a case where the ask depends on the RESULT's content in a way the
     tool cannot see at raise time — none on this page. What stays deterministic at the door
     is a DECLINE on a RESOLVED
     subject (vm-perf-on-array, arm B), where the catalog rule is a row the router can quote —
     a sentence, not an ask.

  The ask is not a rewrite; the model never sees a question it did not cause — the lookup it
  called raised it. The typed field spec is what keeps the ask from being an attack surface
  (§ 7, ASPI): an `enum` / `number` / `boolean` field is validated by `validateValues` BEFORE it
  enters, and enters as a typed value in the tool's own `InputResponseResult` under `answered`
  provenance (§ 5.1; § 15, R3-13); a `string` field is free text and carries no such guarantee
  — the declaration names which it was, and a `string` answer places nothing.

**What no verb can do:** un-stream a draft (draft tokens leave at CallLLM unless
`suppressDraftTokens`, which only `.answerValidation()` sets — § 12, C1); detect ROLE; state
"true".

### 5.6 The rows, the events, the lens

**One row, on `AgentState`, beside `answerGuarantee` — under a checker-side name (§ 13, F11):**

```ts
interface AnswerAssessmentRow {
  readonly assessment: 'known' | 'unrefuted' | 'unknown' | 'not-applicable';
  //   known         — a SUPPORTING row exists for these bytes (§ 15, R3-11)
  //   unrefuted     — checks applied, none fired, no supporting row: the disposition family's "green"
  //   unknown       — at least one reason fired
  //   not-applicable — no check applied
  readonly reasons: readonly AssessmentReason[];        // § 5.3, each with its witness
  readonly basis: { applied: readonly CheckId[]; notApplicable: readonly CheckId[] };
  readonly support?: { kind: 'answer-validation'; reportDigest: string }
                   | { kind: 'claims'; checkedPass: readonly string[] }; // the row `known` stands on
  readonly answerDigest: string;
  readonly iteration: number;
}
// NOT on the row (§ 15, R3-15): `shape` (= AgentState.answerGuarantee, its one owner) and
// `declared` (= the ledger's answer-level standing, whose one writer is recordFindings). The
// fold READS both from their owners at render time; a copy on a sibling field of the same
// state object is the second-writer shape Fold law 2 forbids.

// The deny's typed slot (§ 15, R3-10) — beside `MiddlewareDecisionPayload.why?: string`:
interface PlacementBecause {
  readonly verdict: 'pre-lookup' | 'remaining-lookups';
  readonly subject: string;                      // the assertion's subject id
  readonly rule: string;                         // the unknown(rule) reason quoted
  readonly lookupsRemaining: readonly { tool: string; kinds: readonly string[] }[];
  readonly envelopes: readonly { toolCallId: string }[]; // the absent() rows quoted (remaining-lookups only)
}
```

- **Whose words.** The earlier draft named this row's verdict `standing` with the values
  `known | not-sure | unknown | unassessed`. Both halves collided: `standing` is the MODEL's
  declared word in this library (`findings/types.ts`: "The word is `standing` … the two must
  never share a name"; `agentfootprint.findings.standing` is already registered), and the value
  set half-overlapped `Claim<T>`'s (`known | unknown | not-applicable`, `src/lib/claim/claim.ts`)
  while adding a second model vocabulary beside `fact | open` + `settles`. So: the row is an
  ASSESSMENT, its value set is `Claim<T>`'s own (§ 4 already calls `Claim` "the VOCABULARY of
  'not sure with a reason' as a type"), and the model's own answer-level declaration reuses
  `Standing` through `_findings.answer` (§ 5.2). The owner's three sentences are a RENDERING
  over the row: `known` → "known"; `unrefuted` → "consistent with the record — N checks
  applied, none fired" (never "known"); `unknown` with an ABSENCE reason on the answer's
  subject (`subject-unresolved`, `source-not-consulted`, `existence-not-checked`) → "no idea
  → ask"; `unknown` otherwise → "not sure"; `not-applicable` → "the record did not assess this
  answer". Three sentences plus the honest fourth, on `Claim<T>`'s three words plus the
  disposition family's green (open question 2, rewritten).
- **`known` requires a SUPPORTING row, never silence (§ 15, R3-11).** Round 2 derived
  `known` from "`reasons` empty AND `basis.applied` non-empty" — a positive inferred from no
  row, against consequence 4 ("no row, no clause") and law 5 (never "verified"), and it
  borrowed `Claim<T>`'s word whose owner demands evidence (`lib/claim/claim.ts` · `known(value,
  evidence)`: "A fact stated with its evidence", `evidence` mandatory). On the host it would
  have labelled the flagship false-known reply "known": the retained arm-A disposition is
  `invariant-violation` (wire) checked 3 with every content check `notApplicable`, and
  vm-perf-on-array A is gate `grounded` + `unsupported-argument` checked-pass on a category
  error — `basis.applied` non-empty, `reasons` empty, "No VMs are currently hosted on
  SHPMAXPRDCL001" rendered "known". Now: `known` ⇐ `support` is present — every declared
  `.claims()` field `checked-pass`, or a passed enforce `AnswerValidationReport` for these
  bytes (the one `checked` owner, § 5.1); checks applied and none fired without support is
  `unrefuted`, the disposition family's own green ("no registered check was violated. It
  does not mean no context error exists", `src/integrity/README.md`); nothing applied is
  `not-applicable`. On the host today NO chat answer can be `known` — prose, no `.claims()`,
  no `answerValidation` — and the page says so rather than letting the wire-shape check
  stand in for a fact.
- A declared doubt from the model (the ledger's answer-level `open` standing, read from
  `recordFindings`'s own rows at render time — never copied onto this row, § 15, R3-15)
  NEVER lowers the assessment — it is credited beside it by the lens, and `unsupported-claim`'s
  advisory on a declared doubt is left exactly as it is (one owner per fact: the advisory
  belongs to the claim seam, the credit to the rendering).
- **Where it is written (§ 13, F5).** On `final`, by the OUTERMOST Route wrapper — after
  `withAnswerValidation` has written `scope.answerValidation` (`Agent.ts` composes
  `routeDecider = withAnswerValidation(baseRouteDecider, …)`; the wrapper runs the inner decider
  first and writes the report only once that returned `final`), so `value-unchecked` reads THIS
  turn's report and never `answerGuarantee`. A fold inside the inner decider could not see the
  report at all. It is a LABEL — no branch, no re-ask, no blocking. It rides `turn_end` as a
  reference, is emitted as `agentfootprint.answer.assessed { assessment, reasons: [{ kind,
  witness }], basis }` (never `answer.standing`), registered in `events/registry.ts` +
  `events/payloads.ts`, with one line per reason in `defaultCommentaryTemplates`. Nothing on
  scope beyond the row itself, so it rides the checkpoint the way `findingsLedger` does — and
  it is FOLDED, never stored twice (Fold law 2).
- The ask of § 5.5 files NO event of its own (§ 14, R10): a `requestInput` pause is already
  on the record as `agentfootprint.pause.request` whose `questionPayload` is the whole
  `pauseData` — `awaitingInput` with the question, the fields, the `requestId`,
  `origin.toolCallId` and, once § 10 change 1 ships, the `absence` that prompted it — and its
  answer as `agentfootprint.pause.resume.resumeInput`. The asking LOOKUP's miss, however, IS
  filed as its own rows before the pause — `agentfootprint.tools.absent` and
  `scope.coverageDeclared` through the pause branch's reader (§ 5.5; § 15, R3-9) — so the
  `CoverageBand` and `.limitsTravelWithTheAnswer()` see it exactly as they see a returned
  absence; that is one observed row and one pause row for two facts, not two rows for one.
  Round 1's `clarify_asked` / `clarify_answered` pair would have been a second row for one
  pause and is withdrawn. So a turn that ended in a typed question is on the record as a
  question, with its reason, and the bench reads `pause.request.questionPayload.awaitingInput`
  (and `tools.semantics_declared.semantics.clarify` for a tool that handed back candidates)
  without a `'?'` regex — for the TYPED ask only; a prose ask has no row and is read from the
  reply by hand (§ 8.1, H3). (A pre-run ask is app work and files nothing here — § 5.5 form 2.)
- The placement assertions are recorded ONCE, when the provider is read
  (`agentfootprint.placements.declared`, name open; § 5.2; § 15, R3-10) — the witness every
  deny's `because` and every `subject-unresolved` reason points at; and each before-tool
  verdict rides the existing `agentfootprint.middleware.decision` row with `because` beside
  `why` (the payload today: `middleware`, `moment`, `at`, `phase?`, `toolName?`,
  `toolCallId?`, `iteration`, `outcome`, `changed`, `why?`, `componentId?` — no typed slot).
- A small ledger rule, no door — as a SEPARATE row, never a rewrite (§ 14, R12): a
  `ruled-out` standing whose ONLY witness is an `absent()` or declared-empty result gets a
  derived row beside it — `kind: 'unsettled-by-absence'` (name open), keyed to the standing's
  `toolCallId`, carrying the envelope's `tryInstead` as `settles` — filed through the one writer
  (`findings/ledger.ts` · `recordFindings`) the way 9.110.0's `ContingentRow` is: a separate
  `kind`, "never a second fold", and the assessment fold reads it. The model's own `ruled-out`
  row is untouched and served exactly as declared (`serve.ts`: "the model's words are quoted
  as its declaration and nothing is inferred"). Round 1 re-filed the standing itself as
  `open`, which made the library a second writer of the MODEL's word `standing` — the
  one-owner breach F11 had just corrected — and would have served the model a standing it
  never declared. (The case: an HBA lookup returning zero rows "tested" that a PowerScale
  cluster is an ESXi host, F3.)
- Run-level fold: `lookup-empty` carries `{ empty, total }` over the run, so "every lookup this
  run was empty" is one number on one row (F4).

**Zero cost when undeclared.** The fold runs only on an agent that declared it (name open,
§ 11); an unarmed agent is byte-identical against the 21 references in
`test/core/tools/reference/` and the agent byte-identity references.

**The lens** prints the library's sentence per reason and an assessment chip beside the answer;
`ProofMap` gains a `reasons` overlay on the answer node; `CoverageBand` gains the join
(`existence-not-checked`, `coverage-narrower-than-stated`) drawn from the row, not computed
again. The integrity findings, `middlewareDecisions` and `answerValidation` reports the lens
does not draw today become visible THROUGH the assessment row's witnesses, without a second
renderer for each. Lens laws hold: never infer, no verdict of its own, omit-never-deny, no
sentence of its own.

---

## 6. Control as one instance — "checked" is an assessment that needs a receipt

The host's guard (`be-server/protectedAnalysisFlow.ts`, 457 lines at `05b7a2c`) exists for
one sentence in its own header: "an unchecked number is never PRESENTED AS a checked result. It
must not force the path." Read through § 5, that sentence is an assessment rule: **a value the
answer labels `checked` must carry `checked` provenance — a passed `AnswerValidationReport`
(`mode: 'enforce'`, `status: 'passed'`) for these bytes, and nothing else: not
`answerGuarantee`, which is a shape fact (§ 5.1) — or the label is `value-unchecked`.** Everything
else the guard does is either a check the app owns (what a disk is) or a cursor move (§ 6.3).

### 6.1 The guard's behaviours, folded into twelve rules

The 32 behaviours (B01–B32, the map on the ship-first page) fold into twelve control rules.
"Expressible" means the rule is an assertion at a moment whose verbs match its verdict, with
doors that ship today; "new primitive" means § 5; "door" means a cursor move.

| rule | behaviours | assertion | moment · verb | mark |
|---|---|---|---|---|
| G1 claim admission and selection grounding | B01, B02 (request half), B04–B06 | `run.checkedClaim` and `run.selectionProof` are `given`, derived from `claimed` at the door | the door · allow / typed refusal | expressible; the CARRIER is capability 1 (REQUIRED) |
| G2 the row-selection planner | B07, B27 | `plan.decision ∈ operations(selection)` — a `judged` pick over a `given` descriptor | pre-run · `constrainedEnumPick` (off-enum = parse failure, never a pick) | expressible; only the receipt is missing (ship-first small item) |
| G3 offered-only, solo, once | B08, B12, B13, B17 | (i) the call's name is on this iteration's wire — `toolCalls.ts` · `resolveTool` already refuses (`unknownToolResult`, `notServedResult`); (ii) the batch that names the analysis tool has one call — read from `ctx.history`; (iii) no earlier passed receipt for this claim in this run | before-tool · deny (a correction) | expressible; `solo` becomes OPTIONAL (its page's own four reasons reduce to "refuse before the permission gate", open question 6 there) |
| G4 typed arguments | B10, B11 | args satisfy `inputSchema` | dispatch · `formatToolArgIssues` as the result | expressible, existing (`validateToolArgs`); the claim re-match existed only because admission and dispatch were two steps |
| G5 source admission | B22 | `source(sourceRef)`: kind, producer, coverage complete, bytes ≤ 4 MiB, `head.meta == get.meta`, AND `conflictsOf(rows)` empty | inside the tool today; before-tool via head-first `wants` later | expressible — the conflict half is ALREADY ledger-based (`be-server/vmInventoryFacts.ts` · `inspectVmInventoryFacts` runs `conflictsOf` and throws `VmInventoryEvidenceError`) |
| G6 the receipt | B23–B25 | `result(vm, operation)` is `checked` ⇐ `AnswerValidationReport { mode: 'enforce', status: 'passed', checked ≥ 1, candidateDigest, resolvedRefs ∋ sourceRef }`, epoch = source digest | inside the tool · a nested one-iteration Agent today; `validateAnswer()` standalone (ship-first small item) removes the fake provider | expressible — this is where `checked` provenance is BORN |
| G7 THE CLAIM, model-chosen door (c) | B26, B14 (c), B18/B19 (answer half) | (i) numbers in the answer ⊆ values this turn's results carried — the gate at `guard`; (ii) every value the answer LABELS checked has a passed receipt — a typed carrier ONLY: `.claims()` over `.outputSchema()`, or the `_findings.answer` ride-along of question 8 for a prose chat answer; the label `value-unchecked` when the carrier says checked and no receipt row exists. Round 2 offered "or an output `deny` when 'checked' appears with no receipt row" — struck (§ 15, R3-4): an output-phase message deny is `MessageDeniedError` at the API boundary (`stages/route.ts`: "The answer is NOT released … the boundary raises instead of returning"), which discards the whole answer, inventory included — the F2 shape this page exists to close, on the model-chosen door where § 6.1's own rule says a turn-ending refusal belongs only where a person asked — and "when 'checked' appears" is a string match over prose, which files nothing | Route · correct once (`guard`) / label (`assist`) / refuse (`rails` on VALUES only — the gate's own posture, never a deny on the claim) | expressible; the ruling ("the model may explain; the CLAIM is protected") is this row's whole content — so capability 3 is UNNECESSARY for door (c). A Route-moment REFUSAL on door (c) is the F2 shape and is not offered |
| G8 doors (a) / (b): a person asked, no model speaks | B03 (a)(b), B15, B16, B18, B19, B21 | "dispatch with app-held args, zero model calls" and "the receipt's bytes ARE the answer" | — | NOT EXPRESSIBLE: cursor moves (§ 6.3) |
| G9 refusal shapes by door | B14 | door (c) → a correction (`deny(reason)`, a `failure` envelope, arg issues); doors (a)/(b) → a typed error, never an answer string | dispatch / the door | (c) expressible, shipped at `05b7a2c` and pinned by `tests/be-server-vm-analysis-correction.test.ts`; (a)/(b) with § 6.3 |
| G10 wire receipt, field meanings, stream hold | B20, B28, B16 | not assertions | — | delivery: results out (own page); meanings (after the ontology ruling); the LABEL is expressible, the hold is not |
| G11 form, report reader | B29, B30 | UI | — | app |
| G12 operation-vocabulary drift | B31 | — | — | app fix (13 files) |

The bug F2 exposed has, in these terms, one cause: **an assertion evaluated at a moment that
has no correction verb** (the provider wrapper). The rule this page derives from it: *evaluate
every assertion at the moment whose verbs match its verdict.* A refusal that ends the turn
belongs only where a person asked.

### 6.2 The selection cases (the second design document's table), marked

| case | assertion | mark |
|---|---|---|
| 1 · known PowerScale id + "slow" (F3) | `compatible(skill, request)`: subject kind `given` by a strong rule ∧ the skill's `excludes` with its NOT sentence ∧ every subject placed ⇒ incompatible; beside it `fit = high` (`judged`) — two readings on one key, both kept | expressible: after-tool `allow(result + verdict, why)` on `score_skills`; before-tool `deny` with the NOT sentence on `read_skill` |
| 2 · unknown identifier + "slow" (F1) | an `unknown(rule)` placement assertion: no rule places it, no `observed` or `answered` reading participates on the key; under `participates()` an unknown neither corroborates nor contradicts, so nothing may select on it and no collector may be keyed on it as if placed; the declared placing LOOKUPS for its candidate kinds run first (§ 5.2 `resolves`; they never trip the rule), the one the library marks last asks, then the person's typed answer places it | the CHECK is expressible; the VERDICTS are the two before-tool `deny` arms of § 5.5 (pre-lookup: the rule and the candidate lookups; remaining-lookups: the envelopes quoted and the lookups not yet run — never "the person", who is named only in the ask), evaluated by one library fold with a typed `because`; the ask is `requestInput` with `absence` from the last candidate lookup on the library's `last-candidate` fact — on the record as `pause.request` AND as the lookup's own `tools.absent` row (§ 14, R1 / R4 / R10; § 15, R3-1 / R3-7 / R3-9 / R3-10). Today `deny` only TELLS the model, with a bare sentence, and the ask carries no reason |
| 3 · short alias "006", N matches | `\|placements('006')\| ≥ 2` ⇒ hand back the N candidates, never guess from the naming convention | the check does NOT exist at the door: `cascade.ts` · `'legacy-numeric-ambiguity'` is the router's two-SKILL near-tie (`verdict.action === 'ask'` over skill ids), not N placements of '006', and the shadow row holds `subjects: []`; the names are an inventory RESULT. After the result the moment has no `ask`; the carrier is the tool's own `semantic({ facts, clarify: { question, candidates } })` or a `requestInput` with the N names as enum options, raised from the tool (§ 5.5). On the host's seed N = 1 (`SHISOLPLPAP006`; `SHISOLPRNAP006` is a SyncIQ target, not a cluster), so the honest result is a `known` placement and the case is withdrawn from measurement until the seed or the label is corrected (§ 2; § 14, R2 / R13) |
| 4 · identity vs role; 5 · relationship traversal | assert NOTHING — a placed array is CONTEXT for "the VMs on it"; a kind a skill does not list is `notAccepted` (recorded, still unknown), never an exclusion | expressible as a non-firing rule; the fence is the supported-negative law |
| 6, 8 · empty lookup, resolver failure (+ F4) | `empty-lookup` on a grounded key (advisory, `EMPTY_LOOKUP_CEILING`); `absent()` names its coverage; a `ruled-out` whose only witness is an absence is `open` | (i)(ii) existing; (iii) the small ledger rule of § 5.6 |
| 7, 15 · every candidate incompatible; near-match without capability | requested protocol ∉ `contract.subjects` ∧ ∈ `unsupportedSubjects` (`given`: the host's `SourceCapabilityContract`) ⇒ never substitute; no candidate resurrected | the refusal is expressible (before-tool `deny` with the contract's note); the "explain the gap" answer is model-written or app deterministic text |
| 9, 16 · sole candidate is not certainty; missing input retrievable vs user-only | the operation's required inputs are present in served rows or obtainable by a declared lookup; else ask for exactly the missing fields | `requestInput` inside the tool, existing; at SELECTION there are no rows to fold until skills declare required inputs (`given`) |
| 10–13, 18 · continuity: "yes" after a clarification; incumbent vs new; stale assessment | "yes" answers the pending question only if the clarification was a PAUSE (checkpoint carries `awaitingInput`); incumbent vs new shipped (9.112.1 `decideTier2`, host `be9c9c9` — cited from memory, not re-read); stale = `score.epoch ≠ request epoch` (ContextFootprint's `epoch`: "history, not contradiction") | § 5.5; shipped; existing structure. "Same for yesterday" and compound requests are dialogue state, out of scope |
| 14, 17 | not re-read by the sweep | — |

### 6.3 What still needs a real door, and why

**Doors (a) and (b) of the guard.** A person chose the operation in the Data panel or through
the planner. The rule is "no model speaks": dispatch the calculator with app-held args and zero
model calls, and deliver its receipt as the turn's answer. No fold over rows performs either.
Two library answers exist, and the owner must pick one:

1. **The no-model hop** (capability 2 + 3): nine open blocking issues (O1–O9 on that page),
   every one a consequence of moving the cursor through a chart built for a model call — the
   action never reaches `ToolCalls`' dispatch list, a stale served party, `turn_end` totals,
   `integrityWorkExisted` keyed on `llmLatestContent`, the checkpoint tracker fed only by
   `iteration_end`, the action's carrier, no named refusal mechanism, holding the stream, no
   hosted seam.
2. **A record-only "app turn"** (cheaper, NOT a loop door; needs its own page): the app runs the
   calculator and `validateAnswer()` itself — no agent, so no model call, no chart, no wire
   row, no iteration — and RECORDS the exchange as an app-authored turn: user text + app answer
   + receipt ref + `origin: 'app'`, written to the session history, memory and the recording
   with one event whose sentence the lens prints. Law 1 of the ship-first page ("nothing
   records a model call that did not happen") holds by construction. It inherits exactly one of
   the hop's questions — how an app-made pair renders to the next model call (that page's open
   question 2) — and must say what `standingAgent` sessions, memory and the recording receive.
   Today the receipt is already a digested artifact with `parentRefs` to its evidence
   (`be-server/protectedAnalysis.ts`), so provenance IS recorded; what the library lacks is
   only that the CONVERSATION record can name it as an app action, and that the reply can carry
   it (results out).

Until one of these lands, the faked model stays for doors (a)/(b) only, and the correction of
§ 12 C4 applies: today the form makes zero hosted calls but still runs the whole agent loop
under a faked provider, plus a second one-iteration agent inside the calculator.

**Effect on the doors design, stated plainly.**

| item | verdict under this page |
|---|---|
| capability 1 — run facts (`claimed` / `ground` / `given`) | STAYS and is REQUIRED for G1 (`run.checkedClaim`, `run.selectionProof` — `claimed` → `given` at the door); without it the record cannot say what the app gave and every hook keeps reading an `AsyncLocalStorage`. It is NO LONGER a prerequisite of the ask path (the values are the paused tool's own result, § 5.5) nor of the placement reading (a `placements` port with library-owned rows, § 5.2 — never a shape parsed out of `given`; § 14, R10 / R11) |
| capability 4 — `solo` | OPTIONAL: an assertion over `ctx.history` at before-tool (shipped in the host at `05b7a2c`); keep only for refusing before the permission gate |
| `maxPerRun`, `offered-only` (already dropped) | folds over rows: a passed receipt; the served wire and `resolveTool`'s refusals |
| capability 3 for door (c) | UNNECESSARY: the draft hold (O8), the output equality and emit suppression, `toolAnswer`, `answerSource`, the tool-answer Route arm, the `not-applicable` filings and the three "every run calls the model" sentences (O4) — the claim is protected by the gate + a typed claim carrier (`.claims()` or the `_findings.answer` ride-along) + the `value-unchecked` label, never by an output `deny` (§ 6.1 G7; § 15, R3-4), and the ruling lets the model explain |
| capabilities 2/3 for doors (a)/(b) | REMAIN only here — or are replaced by the app-turn record primitive, which sidesteps O1–O9 wholesale (nothing dispatched through `ToolCalls`, no served party, no iteration counted, no integrity run, nothing for the tracker, no action carrier, no `ActionRefusedError`, no stream held, no footprintjs forward-jump engine change) |
| the small items (`validateAnswer()`, head-first `wants`, enum-pick receipt, unknown-tool sentence, field meanings, results out) | all STAY; each is a provenance carrier (`checked`, `observed`, `judged`) or the reply half |
| the three collisions the owner named | keyed on `llmLatestContent`: hop-only, vanishes with it; fed only by `iteration_end`: hop-only, vanishes with it; caller-claimed vs app-given vs checked: the provenance type of § 5.1 |
| the two standing laws | untouched by every assertion above — the assertion angle is exactly what those laws leave room for |

---

## 7. Prior art, placed

Every source below was opened by the prior-art sweep on 2026-09-23, except the two classical
records marked "record only". Two strands: (a) honest not-knowing, (b) declarative typed
control. The columns say what is borrowed and what this page does differently.

### 7.1 Honest not-knowing — why "make the model say it" is not a prompt

| source | what it shows | borrowed | done differently |
|---|---|---|---|
| Kirichenko, Ibrahim, Chaudhuri, Bell, *AbstentionBench*, arXiv 2506.09038 (2025) | abstention is "an unsolved problem, and one where scaling models is of little use"; reasoning fine-tuning DEGRADES it by 24%; a system prompt "does not resolve models' fundamental inability to reason about uncertainty" | its six scenarios (answer unknown, false premise, stale, subjective, underspecified context, underspecified intent) as BENCH CELLS | not as prompt text; each cell maps to a record-derivable reason (unknown = no row settles it; stale = `basis-stale`; underspecified = a declared input missing) |
| Wen et al., *Know Your Limits*, TACL 13 (2025) / arXiv 2407.18418 | abstention framed from query / model / values | the framing | — |
| Kalai, Nachum, Vempala, Zhang, *Why Language Models Hallucinate*, arXiv 2509.04664 (2025) | under binary grading "abstaining is strictly sub-optimal"; explicit confidence targets ("answer only if > t confident; mistakes penalised t/(1−t); IDK = 0") | the SCORING: the bench gives "I don't know" 0 and a wrong confident claim −t/(1−t) (§ 8); a per-claim-class t the Map can declare | t lives in the bench and on a declaration, never as a runtime classifier gate |
| Lin, Hilton, Evans, arXiv 2205.14334; Kadavath et al., arXiv 2207.05221; Xiong et al., ICLR 2024 / arXiv 2306.13063; Yin et al., Findings ACL 2023 / arXiv 2305.18153; Orgad et al., arXiv 2410.02707; Wagner, arXiv 2607.08456 (2026) | verbalised confidence is overconfident; P(IK) fails to transfer; models encode truth they do not say; answer confidence is "nearly blind to whether the question is answerable" — two axes, two thresholds | self-report kept as a DECLARATION the record can contradict (`declared` on the assessment row); answerability and correctness checked SEPARATELY (absence reasons vs conflict reasons) | a verbalised "sure / not sure" field never decides the standing |
| Manakul et al., *SelfCheckGPT*, EMNLP 2023; Kuhn, Gal, Farquhar, ICLR 2023 / arXiv 2302.09664; Farquhar et al., *Nature* 630 (2024) (OATML post opened); Yadkori et al., arXiv 2405.01563 | sampling-based uncertainty detects confabulation, not falsity; N samples per answer; a declared risk budget with a bound (conformal) | conformal's "declared budget with a guarantee" as the statistical cousin of t — for the bench | not at runtime: the Trace is cheaper and stronger where a row exists; sampling is reserved for the prose stratum, if ever |
| Zhang et al., *R-Tuning*, NAACL 2024 / arXiv 2311.09677; Brahman et al., *The Art of Saying No* (CoCoNot), NeurIPS 2024 D&B / arXiv 2407.12043 | refusal generalises as a meta-skill; GPT-4 wrongly complies with up to 30% of "incomplete / unsupported / indeterminate" requests | CoCoNot's three categories as declarable states: incomplete = a required input absent; unsupported = no offered tool covers it; indeterminate = `sources-conflict` | training is out of scope |
| Li, Kim, Wang, *QuestBench*, NeurIPS 2025 D&B / arXiv 2503.22674; Zhang, Knox, Choi, ICLR 2025 / arXiv 2410.13788; Zhang et al., *Ask-before-Plan*, Findings EMNLP 2024 / arXiv 2406.12639; Li, Wu, Meng, *CIGAsk*, Findings EMNLP 2026 / arXiv 2609.24290; Ta et al., *RegretBench*, arXiv 2607.21143; Edwards, Schuster, *Ask or Assume?*, arXiv 2603.26233; Yang et al., *What Prompts Don't Say*, arXiv 2505.13360 | one missing variable in a CSP; models 40–50% even when they can solve the full problem; "prompting alone is insufficient: models either ask on every query or ask vague questions"; a separate detector beats self-assessment; unspecified requirements regress 2× across model swaps | the missing variable is COMPUTED by the walker from declared requirements (`AwaitingInput.missing[]`); the detector is a guard reading the Map, decoupled from the executing model; REGRET as the bench metric | — |
| Sehwag et al., *ASPI*, arXiv 2605.17324 (2026) | entering the clarification state INCREASES prompt-injection susceptibility | the ask is a TYPED field (`enum` / `number` / `boolean`) validated by `validateValues` before it enters, entering as the paused tool's own `InputResponseResult` under `answered` provenance — never free text merged into context; a `string` field is named as free text and places nothing (§ 5.1, § 5.5; round-1 text said "as `given`", corrected in § 15, R3-13) | — |
| Ross, Mahabaleshwarkar, Suhara, *When2Call*, NAACL 2025 (re-verified); Zhang et al., *ToolBeHonest*, arXiv 2406.20015; Yao et al., *τ-bench*, arXiv 2406.12045; Luo, Wen, Wang, *Agentic Abstention*, arXiv 2606.28733 (2026); Wang et al., *Learning to Ask*, EMNLP 2025 / arXiv 2409.00557 | call / ask / admit inability is a three-way decision models do badly; "the primary reason for model errors lies in assessing task solvability"; abstention in agents is SEQUENTIAL and the failure is TIMING; trajectory-derived stop signals lift timely abstention 26.7 → 57.4 while "larger models sometimes perform worse" | inability is decidable from the Map (no offered tool covers the ask); the stop signal is the Trace (`lookup-empty` N of N, `expectation-missed`); TIMELY abstention (asked BEFORE collectors ran) as a bench column; pass^k for whether declared rules hold across trials | — |
| Advani, arXiv 2606.09863 (2026); Smyth et al., *OverclaimBench*, arXiv 2609.20812 (2026); Wang, Wang, Wu, *The Unreliable Progress Bar*, arXiv 2609.08589 (2026) | "false success": no LLM-judge configuration exceeds AUROC 0.65 because judges "anchor on confident closing language", while trace-feature detectors reach 0.83–0.95; 80.4% of incomplete runs misleading in the agent's own words — "final responses are not reliable accounts of their actions"; "frameworks should not control task flow on the strength of the model's state reports alone" | the ACTION claim class (`action-unwitnessed`): a claim about work whose witness is a tool-call row; and the ruling against keying control on model-call artefacts — `integrityWorkExisted` on `llmLatestContent`, the tracker on `iteration_end` — key on Trace rows of what happened | this is the published case for the owner's direction |
| Gao et al., *RARR*, ACL 2023; Liu, Zhang, Liang, Findings EMNLP 2023 / arXiv 2304.09848; Gao et al., *ALCE*, EMNLP 2023 / arXiv 2305.14627; Li et al., *AttributionBench*, arXiv 2402.15089; Yue et al., Findings EMNLP 2023 / arXiv 2305.06311 | attribution over prose tops out near 80% macro-F1 even fine-tuned; RARR's PRESERVATION metric names the cost of revising an answer to make it attributable | "prose files nothing, ever" stays; attribution of TYPED claims to rows by a DECLARED join is exact; preservation = the canon's cut: refuse or mark, never rewrite | — |
| Xu et al., *Knowledge Conflicts for LLMs*, arXiv 2403.08319 | context-memory vs inter-context vs intra-memory conflicts | the host's grey area is CONTEXT-MEMORY (the model answers from parametric memory instead of the inventory it fetched) — detectable only when the answer is typed and a row holds the fact | so "make the LLM say if it knows" becomes "make every knowable claim typed so the join can run" — a Map declaration, not a prompt |

### 7.2 Declarative typed control — a policy decision point outside the model, fed by facts it did not author

| source | what it shows | borrowed | done differently |
|---|---|---|---|
| Debenedetti et al., *CaMeL*, arXiv 2503.18813 (2025); *AgentDojo*, arXiv 2406.13352 | capabilities (provenance + readers) on every value; a policy sees a tool argument's whole lineage; 77% of tasks with provable security | provenance on every value IS the `claimed` / `given` / `observed` / `checked` / `judged` union; the policy that sees an argument's lineage is the before-tool assertion | CaMeL fixes control flow BEFORE data is read; the host's agent is data-dependent, so the transfer is "label what the model returns by capacity", not "compile the chat to a program" |
| Costa et al., *FIDES*, arXiv 2505.23643 (2025); Siddiqui et al., *Permissive IFC*, arXiv 2410.03055 | lattice labels on tool-result trees; P-T "Trusted Action" (a call is permitted only if the decision rests exclusively on trusted inputs); a TYPE lattice bool ⊑ enum ⊑ string | the capacity lattice as the vocabulary for how much authority an answer carries (an enum pick admissible where a string is not — the door ask's typed fields); P-T IS doors (a)/(b): "the PERSON asked" = the decision rests on trusted inputs; `Hide` = footprintjs redaction 9.19.0 | permissive (influence-based) tainting is an inference and by the canon's cut a rewrite-class mechanism — kept for the bench |
| Shi et al., *Progent*, arXiv 2504.11703 (2025/2026) | JSON-schema rules over tool + args; SMT-checked narrowing-only updates; fallback "return an error message … and continue to finish the user task" | the fallback IS law 2 (a refusal the model can fix is a correction); monotonic confinement = a rule may narrow this run's action space without approval | Progent sees arguments, never RESULTS — the `checked` receipt is outside it and needs the ledger |
| Wang, Poskitt, Sun, *AgentSpec*, ICSE 2026 / arXiv 2503.18666 (HTML full text re-opened 2026-09-23) | `trigger / check / enforce`; the grammar's events are `⟨Event⟩ ::= state_change \| before_action \| agent_finish \| ⟨DomainSpecificEvent⟩` — there is NO `after_action` trigger (round 1 cited one; § 14, R9); the after-observation hook the paper names is `AgentStep`; enforcement `user_inspection`, `invoke_action`, `stop`, `llm_self_examine` | `before_action` ≈ before-tool, `agent_finish` ≈ Route — a declarative surface over hooks the chart has, no new node; the loop's after-tool moment has no AgentSpec twin (`state_change`, fired when the state differs from the previous one, is the nearest) | `invoke_action` shows the explicit action living INSIDE a hook as a consequence, which weighs against the hop; `llm_self_examine` is rewrite-class and not imported |
| Elkoussy, Perez, *AgentLTL*, arXiv 2607.02599; Xiao, Nuzzo, *ContrAgent*, arXiv 2609.18128; Li et al., *VIGIL*, arXiv 2606.26524; Zhang, *Why Formal Monitors Fail*, arXiv 2608.01388 (all 2026); Bartocci, Falcone, Francalanza, Reger, *Introduction to Runtime Verification*, LNCS 10457 (2018) | one spec gates online and audits offline with "deterministic, reproducible verdicts"; value-flow conditions over agent-tool events; recall of any fixed-invariant monitor is bounded by what it names; monitorability | ContrAgent's one-spec-two-roles = the same declaration is the Walker guard online and the Lens verdict offline; the coverage bound IS the ruling "the guard protects the claim it names, not the path", as a theorem | monitorability: "the answer is true" is not monitorable from the trace; "consistent with the trace" is — hence the wording law |
| Xu, Li, Wang, Yang, Chen, *ECLoop*, arXiv 2607.28815 (2026) | evidence conditions ⟨action, entity, required trace event, deterministic sat⟩; satisfaction "evaluated directly from the recorded trajectory … not through model assertions"; conditions resolving to no concrete entity are DROPPED; "postpone" returns the gap to the agent; an "audited fallback" releases the action while marking it unsupported; +10 pp over an NL summary | the closest published analogue: a typed requirement + a Trace witness + a deterministic verdict + a refusal delivered as a correction + an AUDITED FALLBACK that never blocks the path but marks the claim — the exact form of "the guard protects the claim"; "drop conditions with no concrete entity" is "uncollected is unreachable" | — |
| Xiang et al., *GuardAgent*, ICML 2025 / arXiv 2406.09187; Chen, Kang, Li, *ShieldAgent*, arXiv 2503.22738; Chennabasappa et al., *LlamaFirewall*, arXiv 2505.03574; Dantas et al., survey, arXiv 2608.14590 (2026) | NL → formal specs reach only 24–35% semantic correctness; the VERIFIER TAX: intercepting 94% of unsafe actions leaves Safe Success below 5% because agents take alternative unsafe paths | the verifier tax is the field's name for the discarded-answer bug; a hard block on a legitimate route pushes the agent to a worse path — refusals must keep the task completable | model-based auditors and probabilistic circuits are bench instruments, not library doors; the app DECLARES rules in a small typed vocabulary, no model authors them |
| Hadarean, Tristan, "Why Policy in Amazon Bedrock AgentCore chose Cedar for securing agentic workflows", AWS Security Blog, 2026-05-20; Vercel AI SDK, *Agents: Policy-Based Tool Approvals* (both re-opened 2026-09-23) | Cedar: "Each agent tool request made to the AgentCore gateway is evaluated against Cedar policies which determine whether the MCP tool invocation with the given arguments should be allowed" and "Cedar policies always produce the same authorization decision for identical requests, regardless of evaluation order or system state" — a gateway PDP over the invocation request; the post says nothing about results or prior steps. Vercel: "The default OPA `input` shape is `{ tool: { name }, args, messages, runtimeContext }`", outcomes `allow` / `deny` / `requires-approval` / `not-applicable`, with history-aware examples ("Deny a second irreversible action (a push, a delete) in the same conversation") | the history-bearing PDP input is the published counter to "middleware sees one call at a time"; the three-arm outcome is `allow / deny / ask` already | neither has a TYPED join from the answer's claims to result envelopes, receipts and declared expectations — the ledger's actual edge. (Two phrases the earlier draft presented as quotations from the AWS post are not in it — § 13, F10) |
| Guardrails AI (README, `on_fail` docs); Rebedea et al., *NeMo Guardrails*, EMNLP 2023 demo; Singhvi et al., *DSPy Assertions*, arXiv 2312.13382 → `Refine` (DSPy 2.6); OpenAI Agents SDK guardrails | every product validates against a SCHEMA or a classifier, none against the run's RECORD; `FIX` / `FIX_REASK` rewrite, `REASK` re-asks, `REFRAIN` refuses | a declared assertion doubles as a scorer with a threshold (Kalai's t) — the bench decides | `FIX` is a rewrite and is forbidden here ("the model call has no seam") |
| Tsai, Bagdasarian, *Conseca*, HotOS 2025 / arXiv 2501.17070 | just-in-time contextual policies generated per task, human-verifiable | settles a question the owner will face: a model may author a control rule only if it is shown to a person and symbolically bounded | for the host the rule is known at build time, so the app DECLARES and nothing generates |
| Doyle 1979 (TMS); de Kleer 1986 (ATMS, record only); Denning 1976 (lattice); Miller 2006 (object-capabilities); Meyer 1992 (Design by Contract) | beliefs with justifications and IN/OUT status; a lattice over security classes; authority only by reference; a contract "protects the client by specifying how much should be done" and "the contractor by specifying how little is acceptable" | ContextFootprint's `Assertion` + `provenance` + retained witnesses is a TMS belief-with-justification restricted to single-valued predicates per epoch; the declared winner per predicate is TMS resolution with Denning's lattice as its shape; the calculator's postcondition is the guarantee the app relies on; "No Hidden Clauses" is law 5, one record | — |

### 7.3 The verdict the sweep reached — structural beats self-reported wherever a record exists

Quantified on the sources opened: structured trajectory-checked conditions +10 pp over an NL
summary (ECLoop); trajectory-derived stop signals 26.7 → 57.4 timely recall (Agentic
Abstention); trace-feature detectors AUROC 0.83 / 0.95 against LLM judges ≤ 0.65 (Advani);
80.4% of incomplete runs misleading in the agent's own words (OverclaimBench); answer confidence
"nearly blind" to answerability (Wagner); verbalised confidence overconfident (Xiong); P(IK)
fails to transfer (Kadavath); guessing optimal under binary grading (Kalai).

Four caveats the owner must carry: (i) a record proves *unsupported* or *contradicted*, never
*true*; (ii) coverage is bounded by the invariants declared — a rule set protects the claims it
names and nothing else; (iii) prose cannot be joined, so typing the claim is the precondition;
(iv) self-report keeps a role as a declaration the record can contradict, and Kalai's threshold
makes that declaration scoreable.

**What we do differently, in one line:** every system in § 7.2 puts the decision outside the
model and feeds it typed facts. A gateway PDP (Cedar) authorizes the invocation request; a
history-bearing PDP (Vercel / OPA) can read prior steps and results as `messages`; neither has
a TYPED join from the answer's claims to result envelopes, receipts and declared expectations,
they cover only the invariants written, and their specification is the bottleneck. This
library's record is stronger exactly there: it already holds results, envelopes, receipts,
declared expectations and dispositions, so the assertions can be about what CAME BACK, joined
by declaration, and the specification is the app's declarations, not a model's.

---

## 8. How it is measured — on the host, with the step-B corpus

**The standing rule:** benches, demos and hosted tests on the owner's key run on Haiku 4.5
only; Sonnet or Opus only when the owner names the cell. A number is quotable only once a
checked-in bench prints it. Estimates below are labelled as such.

### 8.1 The harness must change before anything is measured (app, no library change)

The 2026-09-23 run cannot answer the questions this page asks, for four reasons the sweep
found in the bench itself:

- **H1 · The record is not retained.** The event-level record for 36 of 45 rows is not on disk:
  one telemetry sink per process, five servers in one process (host `src/agent.ts` ·
  `seoTelemetry`, `scripts/bench/selection-arms.ts` · `main`). Fix: one sink per server (point
  the events log per server), so the RECORDING, not the harness row, is the durable unit.
- **H2 · MATCH never reads truth.** `scripts/bench/selection-observe.ts` · `judgeTurn`:
  "Completed means a right-domain collector ran without error; it never reads the answer's
  truth." A category-error answer (vm-perf-on-array A) and a false existence claim
  (field-slow-powerscale C) scored MATCH. Fix: a TRUTH ORACLE per case from the seed — does the
  name exist, its kind, and the honest label {known, not-sure, ask}.
- **H3 · ASKED is a `'?'` regex** (`asksUser`). An imperative request for the name scored as a
  missed clarification; questions to a resolved subject scored as "unnecessary"; and a GUESS
  with a trailing question scored as an ask — vm-perf-on-array A ("No VMs are currently hosted
  on SHPMAXPRDCL001 … Do you have a different host name?") is `asked: true, match: true` on a
  false-known reply. Fix (§ 14, R6): score "asked" from the REPLY in BOTH conditions, by hand,
  the way false-known is scored — "guess + trailing question" is false-known, never an ask —
  and add the TYPED ask as a separate column read from `pause.request.questionPayload.
  awaitingInput` (and `tools.semantics_declared.semantics.clarify`). NEVER read
  `evidence_checked { action: 'revision-asked' }` as an ask: it means the LIBRARY sent
  unsupported values back to the MODEL for one revision (`src/events/payloads.ts`: "the values
  went back to the model for one more turn"), and the revision can be a re-worded guess
  (unknown-id-slow C/D's shape) — round 1's replacement reader would have counted that as the
  model asking the person, while an honest prose ask outside a revision (arm E's, alias-006
  C/D/E's) has no row and would have scored NOT asked: behaviour change by construction, the
  F7 failure repeated on the ask side. Count an ask after a declared placing lookup as timely
  (`clarified` requires zero collectors today).
- **H4 · Scoring rewards guessing.** Fix (Kalai): correct = 1, "I don't know" / a typed ask = 0,
  a wrong confident claim = −t/(1−t) with t declared per claim class (t = 0.9 for a kind or
  existence claim; t = 0.75 for a performance verdict); plus REGRET against a reference policy
  per case (RegretBench): the same accuracy at a different asking efficiency must show.

### 8.2 What is measured

Nine cases (unknown-id-slow, alias-006, vm-perf-on-array, resolver-unknown,
field-client-talk, field-slow-powerscale, all-refused-protocol, array-backs-vm, the field
VM-disks case), two arms (A = the host's real routing; E = subject evidence in front of the
model, which under capability 1 becomes `given`), two conditions (UNARMED = today; ARMED = the
assessment row + the before-tool ask + parameter kinds), n = 3 per cell.

| metric | reads | the owner's sentence |
|---|---|---|
| honest-ask rate on unknown names | cases whose oracle label is `ask` (unknown-id-slow; alias-006 is WITHDRAWN until the seed or its label is corrected — § 2): did the REPLY ask (hand-labelled in both conditions, H3), with the typed ask (`pause.request` … `awaitingInput`) as a separate column — and before any NON-placing collector ran (timely). A declared placing lookup before the ask is the correct order (§ 5.5); the scorer's `clarified = asked && collectors.length === 0` counts lookups today and is corrected under H3. resolver-unknown is NOT in this set: its oracle label is `known` after the lookup (the seed holds the VM), so arm E's $0.046 ask is a bench miss, measured in the next row — and its armed LABEL can reach `known`/`unrefuted` only once the host declares the HIT shape on `rvtools_get_vms` (§ 5.5, "What counts as a hit"; § 15, R3-3): until then the row reads `subject-unresolved` on a correct answer and label accuracy must report that as the design's own miss, not the model's | "ask the user" |
| wrong-domain runs | a collector of the wrong estate keyed on the subject (resolver-unknown, unknown-id-slow) — and, for resolver-unknown, an ask raised before any placing lookup ran | "say if not sure" |
| post-deny recovery | armed only: after each before-tool `deny` on a collector keyed on an unplaced subject, what the model did NEXT — the named lookup / a prose ask / another collector or an answer (a guess) — read from the record (`middleware.decision { outcome: 'deny' }` and the following `tool_start` or `route_decided`). The deny is the one verb that reaches the reply before it is written, and no recorded turn shows the recovery yet (§ 5.5) | "honestly reason why" — measured, not assumed |
| false-known rate | the REPLY, read against the truth oracle in BOTH conditions (by hand, n ≤ 27): a wrong kind, existence or coverage claim in the person-facing text — the category error, the false "no clusters collected", "decommissioned". Never the row in one arm and the reply in the other: the row is `unknown` the moment any reason fires, while the prose can still say "No VMs are currently hosted on SHPMAXPRDCL001" (§ 13, F7) | "say it if it KNOWS" |
| reason fidelity | every clause of a "not sure" / ask reply names a row that exists in the recording (scored by hand; n ≤ 27 replies). 1.0 by construction ONLY for a typed ask and for the row, whose clauses ARE rows; a model-prose "not sure" is not built from the row and is scored by hand | "honestly reason why" |
| label accuracy | armed only: the row's `assessment` vs the oracle label, `not-applicable` counted apart — reported BESIDE false-known, never in its place. Stated with it: which reasons can change the REPLY (only the before-tool deny / ask — `tool-refused`, `argument-kind-mismatch`, `subject-unresolved` after the lookups — because Route has no correction verb) versus only the row (everything filed at Route) | — |
| cost per turn and per case | `costUsd` from the harness; per-arm from the cumulative meter | the cheapest honest arm on 2026-09-23 was the one that asked from the record |

### 8.3 Budget, as an estimate

The 2026-09-23 run: $5.31 for 159 model calls, n = 1, five arms × nine cases, stopped inside
arm E's last case by the bench's own meter — about $0.118 per turn on average (arm D's
ten-iteration resolver-unknown turn cost $0.34 alone). **Estimate:** 2 arms × 2 conditions ×
9 cases × n = 3 = 108 turns ≈ $13 at that mean; the baseline half alone (unarmed, A and E,
n = 3) ≈ $6.5. These are estimates from one mean; the measured cost replaces them on this page.
Cap: $20 per run, the meter stops the run, and a stopped run is reported as stopped, never as
a rate. An n = 1 run shows WHICH setups asked, not a rate; no rate is quoted below n = 3.

### 8.4 What would count as the result

Stated as hypotheses, not numbers, and derived from the design as written (§ 14, R4 / R8):
on unknown-id-slow, ARMED arm A meets the pre-lookup `deny` at its first collector batch
(iteration 2 on the recorded shape), proposes one of the named candidate lookups (a
`read_skill` switch plus the lookup — two iterations per candidate estate), meets the
remaining-lookups deny if it reaches for a collector between candidates, and the LAST
candidate lookup's miss raises the typed ask with its absence — i.e. the turn ends in a
`pause.request` AFTER the candidate lookups and BEFORE any further collector runs, at about
five iterations for a one-candidate shape and up to seven for the flagship's multi-candidate
SH… shape (§ 5.5, "Who switches skills"; § 15, R3-P4), against arm A's three. Round 1's "asks after the
placing lookup" was not derivable: its rule was silent at the first collector and its ask
fired only on a second guess. The REPLY's false-known rate on vm-perf-on-array falls in the
armed condition (the before-tool deny is the one verb that reaches the reply before it is
written — a label at Route changes the row only); post-deny recovery on unknown-id-slow is
"lookup" more often than "guess" — the hypothesis the deny sentence's coverage boundary is
for, with no recorded precedent either way. **Cost:** the armed cost per case is NOT below
arm E's $0.048 — E asked at iteration 1 with no lookup, and the design deliberately spends a
lookup before asking (correct on resolver-unknown, where E's cheap ask was a bench miss); the
hypothesis is that it stays under arm A's guessing cost plus two iterations (an estimate near
$0.13 at the 2026-09-23 per-iteration mean; the measured number replaces it). Reason fidelity
is 1.0 by construction for typed asks and the row and is checked by hand for prose replies.
alias-006 has no hypothesis until its seed or label is corrected. field-slow-powerscale C's
false sentence is an EXISTENCE claim, closed by step 6's claim class and outside this armed set
— its hypothesis is step 6's, not this one's (§ 13, F7). A hypothesis that fails changes this
page, not the bench.

---

## 9. Order of build — smallest first, each shippable and measured

Each step: design section updated with what the code taught, tests red first, the
byte-identity references unchanged for the unarmed case, the section README's law and example,
CHANGELOG, then the host re-pinned and the bench re-run with the number recorded on THIS page.
Nothing below waits on the hop.

0. **The harness (app).** H1–H4 of § 8.1: record retention per server, the truth oracle
   (with the alias-006 label reconciled to the seed, question 17), the hand-labelled reply
   reader for "asked" plus the typed-ask reader over `pause.request … awaitingInput`, IDK ≠
   wrong scoring. Then the UNARMED baseline at n = 3 on arms A
   and E (≈ $6.5, an estimate). Without this step no later step can be measured; it is app
   work and it is first.
1. **The provenance type and the ledger rule (library).** `Provenance` on the library's
   assertion rows (`src/integrity/assertion/`), the typed field beside ContextFootprint's
   string; the key-strategy pin — both copies share the tuple default, so the side that changes
   is the LIBRARY's legacy-key wrapper if rows from both sides are ever joined, plus the host
   taking 0.1.1 (§ 5.1); and the one fold rule — a `ruled-out` whose only witness is an absence
   gets a SEPARATE derived row (`kind: 'unsettled-by-absence'`, name open) beside it through
   `recordFindings`, keyed to the standing's `toolCallId`, with `settles` from `tryInstead`
   (the string, printed; never parsed); the model's row is untouched and served as declared
   (§ 5.6; § 14, R12). Type-level plus one row kind; a unit test over F3's HBA case that
   asserts the `ruled-out` row is byte-identical before and after; references byte-identical.
2. **The assessment row, from EXISTING rows only (library).** Opt-in; written in the outermost
   Route wrapper after `withAnswerValidation` (§ 5.6); reasons the record already holds without
   any new declaration: `value-unsupported`, `value-survived-revision`, `value-contingent`,
   `sources-conflict`, `claim-contradicted`, `lookup-empty` (with the run count), `basis-stale`,
   `check-unreachable`, `expectation-missed`, `tool-refused`, `value-unchecked` (from the
   report, never `answerGuarantee`). NOT `source-not-consulted` — it needs the typed
   `tryInstead.tool` of step 6 (§ 13, F4). The event, its commentary lines, the lens chip and
   the `ProofMap` overlay. Measured: label accuracy on arm A beside the reply's false-known
   rate; the row's `basis` shows honestly how much of the corpus is `not-applicable`.
3. **The placement fold and its three consumers (library) + the ask with its reason and its
   reader (library) + the host's placing lookups and resolver (app).** Re-cut in round 3
   (§ 15): the library owns the ONE evaluator, the app declares and adapts. Library: (a) the
   pure fold `placementVerdict(call, placements, resolves, argumentKinds, history)` (name
   open) → `{ kind, witnesses }`, exported, with a unit test per kind (`pre-lookup`,
   `remaining-lookups`, `placed`, `last-candidate`, `not-applicable` — the last on a
   bare-wrapper hit and on a batch whose later sibling is a candidate); (b) the `placements`
   provider port yielding ContextFootprint `Assertion[]` through `src/integrity/assertion/`
   with the typed provenance beside the string — NO new placement type — and the
   `agentfootprint.placements.declared` event (name open) filed once when the provider is
   read; (c) `resolves` AND `argumentKinds` on `defineTool` (both copied, both pulled forward
   from step 4 — the arms' "keyed on" predicate needs the kinds); (d) the built-in before-tool
   middleware factory (name open) that calls the fold and denies with the two library
   sentences — pre-lookup: the assertion's rule + the not-yet-run lookups for its candidate
   kinds, NO coverage clause; remaining-lookups: the envelopes quoted + the lookups not yet
   run, NO "ask the person" — carrying `PlacementBecause` on the decision row beside `why`,
   both sentences registered in `test/modelFacingSurfaces.test.ts` by calling the shipped
   composer; (e) `ToolExecutionContext.placement?` (name open), the `last-candidate` fact
   handed to a tool declared with `resolves`, computed by the same fold; (f)
   `InputRequestDeclaration.absence?: AbsenceDeclaration`, validated by the `absent()` rules,
   added to `validateInputDeclaration`'s key allow-list, riding `pause.request` unchanged;
   (g) its READER in the pause branch of `stages/toolCalls.ts`: `declareCoverage` (and the
   `empty-lookup` seam when grounded) over the ask's `absence` BEFORE the checkpoint returns,
   pinned by a test that a lookup raising `requestInput({ absence })` files the same
   `tools.absent` + `coverageDeclared` rows as one returning `absent()`; (h) the `answered`
   provenance tier and the fold's derivation of an `answered` placement from an
   `input_received` row whose `kind` field was a declared enum, pinned by a test that the
   resumed turn's collector keyed on the answered kind is ALLOWED and that
   `'not-in-this-estate'` admits none; (i) the batch-sibling settlement with its three-call
   test (the middle call raises `requestInput`). NO change to `AskPayload`, `MiddlewareAsk`,
   `pauseDemandsDecision`, `Agent.resume`, `RunnerBase.detectPause` or the middleware-ask
   resume path, no after-tool `ask` arm (question 15, ruled), and no `clarify_asked` event
   (§ 14, R10). NOT a prerequisite: capability 1. App, in the SAME step: the host declares
   `resolves` and `argumentKinds` on exactly the lookups and collectors the measured cases
   need — through the generated Python catalog's `_meta.agentfootprint` and an extended
   `src/catalogTools.ts` · `Extras` pick, because `catalogTool` refuses TS-side metadata
   (§ 15, R3-P5); moves THOSE lookups' MISS to `af_absent()` in `py-tools/server.py`
   (`real_rvtools_get_vms` for `vm=` first — the bare wrapper the record holds) and declares
   their HIT as `semantic({ facts: [{ entity, … }] })` (one row) or `semantic({ facts,
   clarify })` (N ≥ 2 on the `LIKE` match) — the TS mock binding's `MockAbsence` is moved the
   same way if the offline path is ever measured; adapts its resolver verdict
   (`{ span, kind, status, rule, origin }`) to placement assertions with `candidateKinds`
   from the shape rule — for a residual SH… name, the several kinds arm E's question names,
   not one; makes its resolver emit an unplaced assertion for a bare token the question
   treats as its subject ("is 006 slow", "is epic-cache-07 slow" are `subjects: []` today — a
   `SUBJECT_SHAPES` change, § 14, R3); makes its placing lookups raise `requestInput` with
   `absence` and a `kind` enum over `candidateKinds ∪ 'not-in-this-estate'` when
   `ctx.placement.verdict === 'last-candidate'` and return `absent()` otherwise; and installs
   the library's middleware factory in its chain in place of a hand-written arm. Measured:
   honest-ask rate (reply, by hand) and the typed-ask column, timeliness, post-deny recovery
   on unknown-id-slow, and the resumed turn's next call after a typed answer (allowed / denied
   / asked again); resolver-unknown is measured as a wrong-domain / false-known case, since
   its oracle label is `known` after the lookup, with label accuracy reported separately for
   the declared-hit and bare-wrapper states; alias-006 is withdrawn until its seed or label is
   corrected.
4. **The kind comparison (library) + the host's kind vocabulary (app).** With `argumentKinds`
   declared in step 3, this step adds what USES it beyond the two arms: the pre-dispatch
   comparison of a call's argument kinds against the participating placement assertions
   (`given` / `observed` / `answered`; never against `given` the run option) as a correction,
   `'name-fragment'` as the kind that never mismatches, and the `argument-kind-mismatch` and
   `zero-not-absence` reasons — the latter fenced to `absent()` envelopes and TOP-LEVEL
   rowsets, never a bare wrapper and never `resultKind` (§ 15, R3-P1). Measured:
   vm-perf-on-array and resolver-unknown false-known rate (the reply).
5. **Removed from the library order (§ 13, F3/F13).** The earlier step gave `admission` an
   `{ ask }` answer and promised alias-006's "which of the two?" at $0. Neither holds: the hook
   never sees the message, its verdict union is closed by law, `AwaitingInput.origin.toolCallId`
   is required, and no record row at the door holds the two names. A pre-run typed ask is app
   work on the wire's `PendingAsk` today, or an owner ruling for a new pause at the input moment
   (§ 5.5 form 2; open question 14). The one library item that would follow a ruling — a
   non-tool `AwaitingInput.origin` variant — is not built before it.
6. **Claim classes and the typed coverage vocabulary (library) + arming (app).** EXISTENCE,
   ACTION and COVERAGE on `.claims()`; `tryInstead: { tool, why? }` and `notChecked[].kind` on
   `absent()` / `coverage()`, `ToolAbsentPayload.tryInstead`; the host arms `.outputSchema()`
   + `.claims()` on its chat agent (or the `_findings.answer` ride-along, open question 8) and
   moves its four `absent(` sites to the object form. Reasons `existence-not-checked`,
   `source-not-consulted`, `action-unwitnessed`, `coverage-narrower-than-stated`. Measured:
   field-slow-powerscale C's false existence claim and field-client-talk's window drift.
7. **The app-turn record primitive — its own page.** Decides doors (a)/(b) against the hop.
   Not started until the owner rules (§ 11, question 6).

Steps 1–2 change no door and can ship in one release; 3 changes no door either — it adds one
fold with three readers, one port on an existing pattern, one execution-context fact, one
field on a pause that exists plus the reader that earns it, one provenance tier, two deny
sentences with a typed slot, one event, and the batch settlement — larger than round 2's
"one field" (§ 15 says so plainly), but every item is a fold over rows or a declaration, none
a cursor move — and its app half (envelopes AND declared hits on the measured lookups, the
catalog `_meta` route for the declarations, the placement adapter, the resolver shape, the
raise on the library's fact) ships in the same step or the rule is silent on the host's own
VM lookup; 4 and 6 need the host to declare. Capability 1 of the ship-first page is required
by § 6 G1 and is built in that page's order; it is no longer a prerequisite of step 3 (§ 14,
R10 / R11).

---

## 10. Laws — kept, and the ones that change

**Kept, unchanged, and relied on:**

- "A middleware cannot answer for the tool" (`src/core/agent/middleware/types.ts` header) and
  "the model call has no seam" (`docs-next/content/docs/build/loop-moments.mdx`). No verdict on
  this page writes a reply or a result.
- "Never infer" (`src/core/agent/findings/types.ts`): no row, no reason, no clause.
- "TYPED STRATUM ONLY — prose files nothing, ever" (`src/integrity/unsupported-claim/check.ts`).
- "Green means no registered check was violated, not that no error exists"
  (`src/integrity/README.md`) — the reason the row's `not-applicable` exists.
- One owner per fact; a Fold is derived, never stored beside the Trace; a Fold hands out
  detached values (docs/design/map-walker-trace-fold-lens.md, the three Fold laws). The
  standing is folded at Route and stored once as the fold's own row.
- A Lens may omit, never deny; every model-facing clause is anchored to the call it was
  composed on (the two Lens laws). The correction sentences of § 5.5 are past-anchored and
  registered in `test/modelFacingSurfaces.test.ts` like every other persistent tool result.
- The ship-first page's laws 1–7: control declared never faked; a refusal the model can fix is a
  correction; the two standing laws stay; caller data never reaches a hook; one record; zero
  cost when undeclared; no chart change.
- "A guess never decides" (the host's compatibility law) — as the minimum-strength rule.
- The `LOOP_MOMENTS` completeness lock: five moments, no sixth.

**Changed, each named:**

1. WITHDRAWN as written in round 1 (§ 14, R10): `core/pause.ts` · `MiddlewareAsk`'s doc
   ("The answer is a DECISION, not a result") is untouched, `AskPayload` gains no field, and
   `pauseDemandsDecision`, `Agent.resume`, `RunnerBase.detectPause` and the middleware-ask
   resume path are not changed. In its place: `core/inputRequest.ts` ·
   `InputRequestDeclaration` gains `absence?: AbsenceDeclaration`, validated at
   `requestInput()` time by the same rules `absent()` applies (`coverage/absent.ts`), added to
   `validateInputDeclaration`'s key allow-list (which refuses unknown keys today), carried on
   `AwaitingInput` and therefore on `pause.request.questionPayload` and the checkpoint
   unchanged; the input-request README gains the row ("an ask may carry the absence that
   prompted it") AND the line that says why the existing `context` slot is not the carrier: a
   library reader files `absence` as observed, and a reader never parses `context` (§ 15,
   R3-8). The reader: `stages/toolCalls.ts`'s pause branch runs `declareCoverage` (and the
   `empty-lookup` seam when grounded) over `inputRequest.absence` before returning the
   checkpoint (§ 15, R3-9). What survives from round 1's change 1: every resume path in
   `toolCalls.ts` settles the paused call's un-dispatched batch siblings with the library's
   fixed sentence, pinned by a three-call test whose middle call raises `requestInput`.
2. WITHDRAWN (§ 13, F13): `admission` gains nothing; `httpHost.ts` and `ingressRecord.ts` ·
   `classify` are untouched. If the owner rules for a pause at the input moment, that ruling's
   own page names its changes; a non-tool `AwaitingInput.origin` variant would be the first.
3. `src/integrity/unsupported-claim/README.md`: the sentence that a declared `null` / 'unknown'
   is an advisory stays; it gains one line saying where declared doubt is CREDITED (the
   assessment row's `declared`), so the two owners are named.
4. `src/integrity/README.md` and the disposition README: the assessment's four words
   (`Claim<T>`'s three plus `unrefuted`, the disposition family's green) and the rule that
   `known` requires a SUPPORTING row — a passed enforce report or every declared claim
   `checked-pass` — never an applied check alone (§ 15, R3-11).
5. A docs law across READMEs: the library says "consistent with the run's record; every
   declared claim supported" and never "verified". Any README sentence that says "verified" of
   an answer is corrected in the same release.
6. `core/tools.ts` · `defineTool` copies `argumentKinds` and `resolves` — both in step 3;
   `Tool.argumentKinds?` / `Tool.resolves?` are the type sites. On the host both ride the
   generated catalog's `_meta.agentfootprint` and `src/catalogTools.ts` · `Extras` (§ 15,
   R3-P5).
7. `coverage/types.ts` · `AbsenceDeclaration.tryInstead` gains the object form and
   `notChecked[]` a `kind`; `absent.ts` validates both at declaration time;
   `events/payloads.ts` · `ToolAbsentPayload` carries `tryInstead`. In the same release,
   `evidence/gate.ts` · `buildEvidenceCorrection`'s clause "If the data was never collected,
   say so plainly — an honest 'that was not collected' is a correct answer" is reconciled with
   grey area B (§ 14, R7): the frame asks the model to say WHAT was looked for and WHERE, in
   the envelope's own words, and never to state that a thing does not exist or was not
   collected unless a result says so — a model-facing sentence, re-registered in
   `test/modelFacingSurfaces.test.ts`.
8. `src/core/agent/types.ts`: a `placements` provider option on the `externalGrounds` pattern
   yielding ContextFootprint `Assertion[]` through `src/integrity/assertion/` — NO
   `SubjectPlacement` type (§ 5.2; § 14, R11; § 15, R3-14); the app adapts its resolver to the
   assertion; hook contexts expose the assertions beside `given`, never inside it; the
   assertions are filed once as `agentfootprint.placements.declared` (`events/registry.ts` +
   `events/payloads.ts`). Names open.
9. Merged into change 6 in round 3: both declarations land in step 3 (§ 15, R3-5 / R3-6).
10. ONE library-owned evaluator with a typed verdict (§ 15, R3-10): the pure fold
    `placementVerdict(...)` (name open) exported from the library; a built-in before-tool
    middleware factory that calls it and denies with the two library sentences (pre-lookup,
    remaining-lookups — the post-lookup "ask the person" sentence of round 2 is struck,
    § 15, R3-1) for a collector keyed on an unplaced subject, registered as persistent
    model-facing surfaces (§ 5.5); the Route fold's `subject-unresolved` reads the SAME
    function; `events/payloads.ts` · `MiddlewareDecisionPayload` gains `because?:
    PlacementBecause` beside `why?` (§ 5.6) so the verdict's witnesses are on the row, not
    only in prose.
11. `findings/types.ts` gains a derived row kind (`'unsettled-by-absence'`, name open) filed
    through `recordFindings` beside a `ruled-out` standing whose only witness is an absence;
    `serve.ts` quotes it under its own heading the way it quotes `contingent`; the model's
    standing is never rewritten (§ 14, R12).
12. `core/tools.ts` · `ToolExecutionContext` gains `placement?: { subject; verdict:
    'last-candidate' | 'candidate' | 'not-a-candidate' }` (name open) for a tool declared with
    `resolves`, computed by change 10's fold in `stages/toolCalls.ts` where the context is
    built — the fact a placing lookup raises `requestInput` on (§ 5.5; § 15, R3-7). A
    `priorCalls` view is NOT added (a second evaluator).
13. `Provenance` gains `'answered'` (§ 5.1; § 15, R3-13), mapped from `AwaitingInput.origins`
    `'response'`; the assessment fold derives an `answered` placement assertion from an
    `input_received` row whose request carried `absence` and whose `kind` field was a declared
    enum (§ 5.5, settlement; § 15, R3-5). No provider re-read; the record is the source.
14. `AnswerAssessmentRow.assessment` is four-valued (`known | unrefuted | unknown |
    not-applicable`) with `support?` as `known`'s witness; `shape` and `declared` are NOT on
    the row — the fold reads `AgentState.answerGuarantee` and the ledger's answer-level
    standing from their owners at render time (§ 5.6; § 15, R3-11 / R3-15).
15. § 6.1 G7: the output `deny` alternative is struck; the claim is protected by the gate, a
    typed carrier and the `value-unchecked` label (§ 15, R3-4).

**Deliberately NOT changed:** `MessageOutcome` has no `ask` — and this page adds NO pre-run
ask to the library either (§ 5.5 form 2 is app work, or an owner ruling); the after-tool
moment has no `ask` (the invited case was brought in round 3 and RULED not needed for it —
question 15; § 5.5 form 2); `AskPayload` and `MiddlewareAsk` (round 1's form 1 is withdrawn);
`requestInput` as the raiser of a typed ask from inside a tool (it gains one optional field,
a reader for it, and a fact on its context — no new pause shape); `ToolExecutionContext` gains
no history and no `priorCalls`; `InputRequestDeclaration.context` (stays opaque; no reader
ever parses it); `AgentRunOptions.given` stays opaque to the library (no shape is ever parsed
out of it); no `SubjectPlacement` type (the assertion algebra is the type); `unsupported-claim`
never re-routes; the gate's postures and its one-revision law; the three "no dedup" sentences;
`AgentState.answerGuarantee` (a shape fact, never read as provenance, never copied onto the
assessment row); `agentfootprint.findings.standing`, the word `standing` and every row the
model declared (the model's, untouched — the library files rows BESIDE them, never over them,
and never copies them onto the assessment row); `externalGrounds` (the placements port is a
sibling, not a change to it).

---

## 11. Open questions for the owner

1. **Name.** The declaration that arms the fold: `.assessment()`, `.answerAssessment()`, or
   `.honest()` — not `.standing()`, which is the model's word (§ 13, F11). And the reason-row
   name `AssessmentReason`.
2. **Whose words.** Proposed (§ 5.6, rewritten in round 3): the row's `assessment` uses
   `Claim<T>`'s three — `known / unknown / not-applicable` — PLUS `unrefuted`, the
   disposition family's green ("no registered check was violated") as a word, because
   `known` may not be inferred from silence (§ 15, R3-11); the owner's three sentences are
   RENDERED from `assessment × reason kind` (an absence reason on the subject = "no idea →
   ask"; any other reason = "not sure"; `unrefuted` = "consistent with the record — N checks
   applied, none fired"); `not-applicable` is the disposition family's word for "the record
   did not assess this answer". The alternative the owner may prefer: the disposition family's
   own per-encounter words (`checked-pass`) instead of `unrefuted`. Either way it is one
   borrowed word, not a fourth vocabulary.
3. **Opt-in or always-on.** Honesty argues always-on; law 6 (zero cost when undeclared) argues
   opt-in. Proposed: opt-in until the byte-identity cost of the fold is measured, then decide.
4. **Where the standing reaches the person.** The reply half is "results out" (own page). Until
   then the host drains the row as it drains `evidence` today. Rule now, or with results out?
5. **The winner per predicate.** Who declares it — `.claims()` per field, the tool per
   `argumentKind`, or a run-level table — and is "no silent winner, assessment = unknown" the
   right default?
6. **Doors (a)/(b): the hop or the app turn.** § 6.3. The app-turn primitive needs its own page
   before anything is built; the hop has nine open issues. Which page is written next?
7. **`expectation-missed`.** A `judged` expectation against an `observed` outcome: a reason on
   the assessment (it lowers `known` to `unknown`), or a lens fact only?
8. **Claim classes on a prose chat answer.** `.claims()` needs `.outputSchema()`; the host's
   chat answer is prose. Proposed: the reserved `_findings` ride-along already carries typed
   answer metadata beside a JSON answer (`reserved.ts` · `RESERVED_ANSWER_KEY`) — extend it
   with `answer: { claims, standing }` (the ledger's own `Standing`) for agents that will not
   type the whole answer.
9. **The bench cells and thresholds.** Adopt AbstentionBench's six scenarios and CoCoNot's three
   categories as cells; t = 0.9 for kind / existence claims and 0.75 for verdicts — or other
   values the owner names.
10. **ContextFootprint.** Both copies share the tuple default key; the library's wrapper is the
    side on the legacy delimiter key (§ 5.1). Does the library keep its legacy key once rows
    from both sides are joined (it collides on embedded delimiters), and does the host take
    0.1.1 for the `__proto__` fix?
11. **Selection inputs.** Should skills declare REQUIRED INPUTS (`given`) so "sole candidate
    with incomplete coverage" has rows to fold at the routing moment (§ 6.2, cases 9 and 16)?
12. **Three meanings of `checked`.** The provenance tier, `answerGuarantee: 'checked'` (a
    shape fact) and the disposition `checked-pass` share one word. Rename the tier (e.g.
    `receipted`), or keep it and rely on § 5.1's rule that only the receipt spells it?
13. **Batch siblings on a pause-resume.** § 5.5 settles the paused call's un-dispatched
    siblings with a fixed "not executed" sentence so the model re-proposes them — for ANY pause
    raised inside a batch, `requestInput` from a placing lookup included. Should they instead
    be DISPATCHED on resume (each through its own chain, so a second pause in the same
    iteration becomes possible)?
14. **A pause at the input moment.** The only honest home for a library-owned pre-run ask is a
    new pause the middleware header forbids by law. Rule on it as its own page, or leave
    pre-run asks to the app's router on `PendingAsk`?
15. **An `ask` arm at the after-tool moment — RULED on this page (§ 5.5 form 2; § 15,
    R3-9).** Round 3 brought the case the header invites (raise after the lookup's `absent()`
    is on the record, with a library-owned trigger). Ruling: not needed for it — the trigger
    fact is decidable before the call and handed to the tool, the miss is filed by the pause
    branch's reader, and the arm's settlement (two results for one `tool_use`; a raw result
    held on the checkpoint; a fifth resume path; a new `ToolResultOutcome` member; a
    `pauseDemandsDecision` arm) buys nothing this case lacks. The header's side-effect
    objection is NOT the ground (a lookup is read-only); the ground is that nothing needed is
    on the far side of the result. Reopened only by a case whose ask depends on the RESULT's
    content in a way the tool cannot see at raise time. The owner may overrule; the page
    records the library-correct call and its reason.
16. **Who declares candidate kinds.** The `candidateKinds` predicate on an unplaced assertion
    comes from the app's shape rule (§ 5.2). Should the library refuse an unplaced assertion with no candidate kinds
    (then the pre-lookup deny can name no lookup and stays silent, honestly), or accept it and
    file `subject-unresolved` with an empty lookup list?
17. **alias-006's truth.** Correct the seed (a second 006 `ps_cluster` row plus its inventory
    row) and keep the label, or correct the label to what the seed holds (`known` after the
    lookup)? Until one is done the case is not measured (§ 2).
18. **A definition-time coverage boundary.** Round 3 cut the pre-lookup deny's clause "the
    collectors you proposed read collected samples, not whether it exists" because no row
    holds it before the collectors run (§ 15, R3-2). It could return only from a NEW
    declaration on `defineTool` (e.g. `coverage: { existence: 'not-checked' }`, name open) —
    the same fact `absent()` states at result time, honest only for tools whose boundary is
    static. Add it in step 6 beside the typed coverage vocabulary, or never (the
    remaining-lookups arm already quotes the boundary from envelopes)?
19. **`answered` against `given`.** When a person's typed answer and the app's resolver
    disagree on one subject's kind (the person says "a VM", the naming rule said "a PowerMax
    array"), which wins? Proposed: neither by default — a `ConflictRow` and `unknown` — with
    the app free to declare `answered` the winner for the `kind` predicate (§ 5.1, no silent
    winner). The tier itself is not in question; its rank is.

---

## 12. Corrections to what I told the owner

Before the sweeps, the author made four claims to the owner. An adversarial check read each
against the code. None held in full. Each is recorded here with its verdict, the reason in
short, and the corrected wording — so the owner never has to find the difference by hand.

**C1 — "The assertion angle avoids the collisions the hop hit and bypasses nothing." PARTLY.**
The first half holds only for the chart-changing half of the doors design: O4
(`integrityWorkExisted` reads `llmLatestContent`) and O5 (the tracker fed only by
`iteration_end`) are the hop's collisions, not run facts' or `solo`'s. "Bypasses nothing" is
overstated: an assertion checked at the answer seam still meets (1) streaming — draft tokens
leave at `stages/callLLM.ts` unless `suppressDraftTokens`, which `src/core/Agent.ts` sets only
under `.answerValidation()`; (2) the Route decider is the ONLY answer seam, with a fixed judge
order (wrap-up → message chain → schema → steps → evidence → claims) and laws a new judge must
honour — a denied answer is never judged or re-asked, no re-ask after a limit fired, one
revision per turn, each revision costs an iteration (`route.ts` · `judgeEvidence`, `mayRevise`,
`decideBranch`); (3) the integrity family's own laws — "silence is not a verdict" and, at the
claim seam, "it never re-routes" — so a CORRECTION at the claim seam contradicts the family the
assertion joins; (4) typed stratum only — `.claims()` refuses without an output schema; (5) the
evidence corpus is the LIVE WINDOW, not the record (`evidenceIndex.ts` header); (6) values in a
committed ledger key ride the commit log, recordings and the pause checkpoint, which is never
redacted; (7) the request and reply halves are untouched by an assertion.
*Corrected wording:* "The hop kept breaking because it faked a model call and the library's
safety nets key on a real one. Checking an app-declared assertion against the record avoids
THAT collision, but it still has to live in the Route decider under its judge order and limits,
hold the stream if it wants to act before the answer leaves, read a typed answer (or the
record, not the window), file a disposition on every exit, and pick a side between the
evidence gate's 'correct once' and the integrity family's 'detect, never re-route'. A broken
rule before a tool is already a correction (middleware deny); a broken rule before the answer
needs a new correction branch — a small one on the evidence-recheck pattern, but new." This
page therefore makes the assessment a LABEL at the answer and reserves corrections for the tool
boundary (§ 5.5).

**C2 — "A broken rule is handed back to the model as a correction, before a tool runs and
before the answer goes out, without throwing the answer away." PARTLY.**
Before a tool: HOLDS today (`DenyOutcome`; the host's `toolMiddleware`; `validateToolArgs`).
Before the answer: WRONG as a statement about today. `messageMiddleware` output can only
transform or withhold (`deny` → `MessageDeniedError`: "A DENIED answer is never judged or
retried"), and its context cannot read a receipt; `.answerValidation()` withholds or records
and "cannot replace the accepted answer"; `.claims()` files and never re-routes; the only
app-declared re-ask that exists is a `.reliability()` post-decide rule whose feedback is
EPHEMERAL (never in `scope.history`), shares one CallLLM bracket, sees the wire not the record,
and escalates to fail-fast once a chunk has streamed (`stages/reliabilityExecution.ts`).
*Corrected wording:* "Before a tool runs, the library already does this: a middleware deny (or
a schema refusal) is the tool result and the model continues — nothing is lost. Before the
answer goes out, the library can today WITHHOLD (message deny, answerValidation enforce) or
RECORD (observe, .claims()) — it cannot hand an app-declared correction back to the model and
keep the loop going; that needs a new Route branch modelled on evidence-recheck, and the
stream must be held for it to be 'before the answer goes out' at all."

**C3 — "Five mechanisms were built separately; one declared form replaces them." PARTLY.**
The five are not five: the findings ledger, the integrity checks and ContextFootprint share one
assertion + conflict substrate (`src/integrity/assertion/conflicts.ts` delegates;
docs/design/2026-09-findings-ledger.md: "RESOLVED … no new dependency"); the compatibility
shadow is the host's, off by default, and excludes nothing; the token gate is a separate
substrate. The count omitted the two mechanisms that already ARE typed assertions over the
record — `.answerValidation()` and `.claims()` — which withhold or record rather than correct.
Their moments and consequences differ by design, and two state opposite laws.
*Corrected wording:* "The library already checks answers in several places, and three of them
already share one substrate. The token gate is a separate substrate, and the compatibility
shadow is your app's, not the library's, and it excludes nothing. The two mechanisms that
already ARE typed assertions against the record are `.answerValidation()` and `.claims()` —
and neither corrects, they withhold or record. So the work is not 'one form over five' but a
per-rule choice of when it is checked, what it reads and what happens when it breaks." That is
§ 4's last paragraph and § 5.4's table.

**C4 — "The Data-panel button involves no model at all; it could be an app call that records
its receipt, no library door." PARTLY.**
Zero HOSTED calls, yes — but the form's path today runs the FULL `Agent.run` through
`standingAgent` under a provider wrapper that fakes the model twice (`selectedResponse`
returns a synthetic `tool_use` with 0/0 usage under the host's own explicit-analysis providerRef, then
the receipt as a synthetic `end_turn`), bypasses the window planner, overwrites the answer in an
output middleware, and throws on mismatch (`server.ts` · `answerTurn`); and the calculator
itself runs a SECOND one-iteration Agent over a deterministic provider purely to reach
`.answerValidation()` (`be-server/protectedAnalysis.ts` · `executeProtectedAnalysis`). Two
model-shaped runs on the record with a fabricated `tool_use` — the thing law 1 forbids. It CAN
become an app action recording its receipt (the receipt is already an artifact with
`parentRefs`; standalone `validateAnswer()` removes the inner fake agent) — but the library
still lacks a way to put an app-authored turn on the conversation record labelled as such
(`SessionLifecycle.persist` is last-write-wins over an `AgentRunCheckpoint`; nothing marks
`origin: 'app'` on an `LLMMessage`) and a reply that carries more than a string.
*Corrected wording:* "The Data-panel button never needs a hosted model, but today it still runs
the whole agent loop with a faked provider (and a second one-iteration agent inside the
calculator) because that was the only way to reach the library's dispatch, answer-validation
and transcript. It can become an app action that records its receipt: the receipt is already
an artifact, and standalone `validateAnswer()` removes the inner fake agent. What the library
still lacks for it is small and chart-free — a way to put an app-authored turn on the
conversation record, labelled as such, and to carry a structured reply — not a no-model hop."
That is § 6.3's second option.

**What the check found that the author had not said** (each now on this page):

- The library's "not sure" vocabulary lives on TOOL RESULTS (`absent()`, `coverage()`,
  `limitsTravelWithTheAnswer`) and on the MODEL's declarations (`open` + `settles`), never on
  the answer's own certainty or the WHY of an "I don't know" — the evidence correction frame
  asks for it in prose (`gate.ts` · `buildEvidenceCorrection`: "an honest 'that was not
  collected' is a correct answer"), and no reader can tell an honest abstention from a lazy
  one. → § 5.6, the assessment row.
- "Ask" exists only as a model-chosen pause and a before-tool consent; deliberately none at the
  answer boundary. → § 5.5, the tool's own `requestInput` gaining the reason it carries; the
  pre-run form is app work or an owner ruling (round 2 withdrew the before-tool form, § 14,
  R10).
- The trust tiering already exists in three places (`HostRequest.decision`, `externalGrounds`,
  `answerValidation` evidenceRefs); capability 1's `claimed` / `given` is a fourth spelling.
  → § 5.1 reuses their words.
- The gate is a fabrication detector, not a correctness judge, and cannot see mis-referral;
  the findings judge is advisory-grade (0.18–0.23 accuracy on the owner's record). → § 4.
- CONFLICT ≠ ABSENCE ≠ STALE, and "no idea" is usually absence, which `conflictsOf` cannot
  express. → § 4, § 5.3.
- Two ContextFootprint copies are in play. → § 5.1, question 10.
- The host already renders the gate verdict as a three-state mark (`be-server/grounding.ts`);
  what the record lacks is the model's own declared certainty to show beside it. → § 5.2.
- O4 is imprecise as stated: seed commits `llmLatestContent = ''`, so `integrityWorkExisted` is
  true on every run that reached seed; whether the family should key on a real "a model call
  completed" fact has not been asked. → § 7 (Unreliable Progress Bar), question for the hop
  page.
- `solo` refuses BEFORE the permission gate, which a middleware deny today does not. → § 6.1,
  G3 ("optional", not "unnecessary").
- The receipt's provenance IS recorded (an artifact with `parentRefs`); only the conversation
  record and the reply cannot name it. → § 6.3.

---

## 13. Corrections from review round 1 (2026-09-23)

Fifteen blocking findings from four lenses, each re-verified against the code and the recorded
runs before it was applied; all fifteen held, none was rejected. One line each: what was wrong,
what changed, and — where the design cannot solve the case — what it still needs.

| # | lens | was | now |
|---|---|---|---|
| F1 | field | § 5.5 form 1 had no tool-result semantics: an approved `ask` re-runs the chain from `askIndex + 1` and dispatches the REAL tool with the checkpointed args, so the person's answer reached neither the tool nor the model; `pauseDemandsDecision` reads `bag.ask` as a consent gate, so `Agent.resume` throws `DecisionRequiredError` on an `InputResponse` | the settlement is defined (§ 5.5 form 1): values enter through capability 1's resume door as `given`; the chain re-runs from the ASKING link; its `allow` (re-keyed) / `deny` (the library's sentence from the typed fields) is the only channel to the model; the three readers and the resume path are named change sites (§ 10, change 1). The zero-library-change door — `requestInput` from an app placing lookup — is named with what it lacks (the record). **Superseded in round 2 (§ 14, R10):** form 1 and its settlement are withdrawn; the `requestInput` door IS the design, what it lacked was the REASON (one field), and the pause was already on the record |
| F2 | field | form 1's flagship case batches three collectors (`parallelCount: 3`); a before-tool pause on the first never dispatches the siblings and the resume settles one call, leaving `tool_use` blocks with no `tool_result` — pre-existing for `checkIn` / `askHuman`, unchecked by the page | the batch settlement is a named library change (every resume path settles un-dispatched siblings with a fixed sentence; a three-call test); `parallelToolCalls: false` is the stopgap; dispatch-on-resume is open question 13. **Re-scoped in round 2 (§ 14, R10):** the settlement survives form 1's withdrawal — it covers ANY pause raised inside a batch, `requestInput` from a placing lookup included |
| F3 | field | alias-006 was mapped to a door-level ask that could state the two cluster names at $0; no record row at the door holds them (`subjects: []`, `ask-facet` over product facets, the cascade reason is a skill near-tie) | alias-006 is lookup-then-ask (form 1 after `pscale_cluster_inventory`, enum options); § 2, § 6.2 case 3 and step 5 corrected. **Superseded in round 2 (§ 14, R2 / R13):** the after-tool ask does not exist, and the seed holds ONE cluster ending in 006 — the case is re-mapped and withdrawn from measurement until its seed or label is corrected |
| F4 | field | `source-not-consulted` and `existence-not-checked` read tool names and existence out of PROSE (the `tryInstead` string, `notChecked[].what`), and `ToolAbsentPayload` has no `tryInstead` | a typed coverage vocabulary is a § 5.2 declaration (step 6); until it ships both are lens lines that decide nothing; § 2's "every clause is a row" now says the coverage clause QUOTES the row's prose |
| F5 · F9 · F12 | field · facts · design | `answerGuarantee` was named a carrier of `checked` provenance; its `'checked'` value is a SHAPE fact (text parsed by the output schema, the default), written before any host check runs; the fold as placed could not see this turn's report | `checked` has one owner — a passed enforce `AnswerValidationReport` for these bytes; `answerGuarantee` is a `shape` fact on the row and never provenance; the fold runs in the outermost wrapper after `withAnswerValidation`; § 5.1, § 5.3, § 5.6, § 6 corrected; the naming collision is open question 12 |
| F6 | honest-or-labelled | a before-tool rule keyed on `unresolved` fired on the PLACING lookups first, and § 8.2's "timely" scored lookup-then-ask (the bench's own correct path) as late; the E arm's resolver-unknown ask the page cited approvingly is a bench miss | placing lookups are a declaration (`resolves`, `'name-fragment'`); the rule order is written (lookups → ask on empty → deny collectors); an unknown never participates, so an `observed` placement extinguishes `subject-unresolved` without a winner; "timely" = before any NON-placing collector; resolver-unknown is measured as false-known, not honest-ask. **Refined in round 2 (§ 14, R1 / R8):** the order gains the arm the record reaches (a collector BEFORE any lookup ⇒ the pre-lookup deny), is keyed on the subject's candidate kinds, and pins "ask after the LAST candidate lookup". **Refined again in round 3 (§ 15, R3-3 / R3-7):** the HIT must be declared too, or the correct lookup-then-answer turn stays `subject-unresolved`; and "last" is the library's fold, not the tool's knowledge |
| F7 | honest-or-labelled | false-known read the LABEL in the armed arm and the REPLY in the unarmed arm, so "falls to zero" was true by construction while the prose could still be wrong; "reason fidelity 1.0 by construction" was claimed for prose replies | false-known reads the REPLY in both conditions; label accuracy is a separate column stating which reasons can change the reply; reason fidelity 1.0 is scoped to typed asks and the row; field-slow-powerscale moved to step 6's measurement |
| F8 | facts | "the library depends on 0.1.1 (the safe default key), the host vendors 0.1.0 (the legacy delimiter key)" — reversed on both sides, and 0.1.0 → 0.1.1 is the `__proto__` fix, not a key change | both copies share the tuple default; the LIBRARY's wrapper opts into the legacy key, the host compares on the default; § 5.1, § 4, step 1 and question 10 rewritten |
| F10 | facts | two phrases were presented as quotations from the AWS post and are not in it; "they see ARGUMENTS, never results or prior steps (Cedar says so)" contradicted the page's own Vercel source (`messages` in the PDP input) | the row quotes the post's real sentences; § 7.3 states the differentiator as the typed join from claims to envelopes, receipts and expectations |
| F11 | design | the derived row was named `standing` — the MODEL's word by the library's own header — with a value set that half-overlapped `Claim<T>` and a second model vocabulary | `AnswerAssessmentRow` / `assessment` / `agentfootprint.answer.assessed`; values are `Claim<T>`'s three; the model's answer-level word reuses `Standing`; questions 1 and 2 rewritten |
| F13 | design | step 5 gave `admission` an `{ ask }` arm: the hook never sees the message, its union is closed by law, and `AwaitingInput.origin.toolCallId` is required | step 5 removed from the library order; a pre-run ask is app work on `PendingAsk` or an owner ruling (question 14); § 10 change 2 withdrawn |
| F14 | design | step 3 never said who consumes the values; "enters as `given`" contradicted capability 1 (`given` is cloned at a door, never committed to scope); the ASPI claim held only for `enum` fields | the settlement of F1; capability 1 is a HARD prerequisite of step 3; only `enum` / `number` / `boolean` fields carry the ASPI guarantee and a `string` field is named as free text. **Superseded in round 2 (§ 14, R10 / R11):** the values are the paused tool's own `InputResponseResult` (today's settlement), so capability 1 is no longer a prerequisite of step 3; the field-type rule stands. **Completed in round 3 (§ 15, R3-5 / R3-13):** the values carry the `answered` tier and the fold derives a placement from them |
| F15 | design | `zero-not-absence` read a bare `{ count: 0 }` wrapper (an undeclared shape); `source-not-consulted` string-matched a tool name in prose | both fenced to declared shapes (`absent()` / `coverage()` envelopes, `resultKind` / `resultColumns` rowsets, the typed `tryInstead.tool`); a bare wrapper is `not-applicable`, as `empty-lookup` treats it |

**What the design still could not do after round 1, said plainly:** state a typed question
before any run from the library (form 2 — app work or a ruling); decide `source-not-consulted`
or `existence-not-checked` until the coverage vocabulary ships; change a REPLY at Route (a label
only — the one correction verb before the answer is the before-tool deny / ask); or hold a pause
on one call of a batch without the sibling settlement landing first. Round 2 (§ 14) changed
the first item's neighbour: the typed ask is no longer a library door at all.

---

## 14. Corrections from review round 2 (2026-09-23)

Thirteen blocking findings from the same four lenses, each re-verified against the code and
the recorded runs before it was applied — the retained arm-A records (`…-1790173253876`
unknown-id-slow, `…-1790173370529` alias-006, `…-1790173415418` vm-perf-on-array, and the
routing-shadow rows of every retained run), the host's seed (`11-powerscale.lp`), `data.ts`,
`toolBindings.ts`, `tools-catalog.json`, `be-server/routing.ts`, `scripts/bench/selection-
{questions,observe}.ts`, `docs/measurements/selection-arms-2026-09-23.json`, `py-tools/
server.py`, and the library's `middleware/types.ts`, `events/payloads.ts`, `evidence/gate.ts`,
`core/pause.ts`, `core/inputRequest.ts`, `core/Agent.ts` · `resume`, `core/RunnerBase.ts` ·
`emitPauseRequest`, `lib/semantics/types.ts`, `findings/{types,ledger,contingent,serve}.ts`,
`core/agent/types.ts` · `ExternalGroundsProvider`, and the AgentSpec full text. All thirteen
held; none was rejected. One line each: what was wrong, what changed, and — where the design
cannot solve the case — what it still needs.

| # | lens | was | now |
|---|---|---|---|
| R1 | field | the before-tool rule defined verdicts only for "lookups ran and came back empty ⇒ ask" and "a lookup placed it ⇒ allow"; the state the flagship record actually reaches — a COLLECTOR batch keyed on the unplaced name BEFORE any placing lookup ran (`read_skill` → three collectors, no inventory, no VM lookup, zero denies) — had no verdict, so the run stayed byte-identical; and the VM lookup the page named returns a bare wrapper on a miss, which § 5.3's own fence makes not-applicable | a third verdict, explicit: the PRE-LOOKUP `deny` on a collector keyed on an `unplaced` subject, its sentence composed from the placement row, the not-yet-run lookups for the subject's candidate kinds (a join over `resolves`) and the coverage boundary; the candidate lookup for an SH… shape is the VM inventory, not `pscale_cluster_inventory`; the host moving `rvtools_get_vms` to `absent()` on a miss is a build requirement of step 3 itself; the extra iterations are in § 8.4's hypotheses. STILL NEEDS: a recorded turn showing the model recovering from the deny (post-deny recovery is a bench column, § 8.2). **Corrected in round 3 (§ 15, R3-1 / R3-2):** the post-lookup arm is replaced by a remaining-lookups arm, and the pre-lookup sentence loses its coverage clause |
| R2 | field | alias-006 was mapped to "form 1: an after-tool rule ⇒ ask which" — form 1 is defined at before-tool, the after-tool moment has no `ask` (`ToolResultOutcome = AllowOutcome \| DenyOutcome`; the middleware header's refusal; § 10 keeps it) — and to data the seed does not hold: ONE `ps_cluster` row ends in 006 (`SHISOLPLPAP006`); `SHISOLPRNAP006` is a SyncIQ `target_host` only; the bench label asserts two | the after-tool ask wording is removed everywhere; the carrier for "N match" is the tool's own `semantic({ clarify })` or a `requestInput` with enum options, raised from the tool; alias-006 is re-mapped from the record (a `known` placement plus a SyncIQ target of the same suffix) and WITHDRAWN from the measured set until the seed or the label is corrected (question 17). STILL NEEDS: that correction — the case cannot be a truth oracle as it stands |
| R3 | field | `subject-unresolved` fired "(or no subject)" — on `subjects: []`, where no span, rule or digest exists to witness, a clause composed from the ABSENCE of a row; both remaining F1 cases the page claimed (alias-006, resolver-unknown) are `subjects: []` on the record, and every fleet question would have rendered "no idea → ask" | fires only on an `unplaced` placement row for a span the question treats as its subject; an empty list is `not-applicable`; step 3's app half requires the host's resolver to emit an `unplaced` span for a bare token the question treats as its subject (a `SUBJECT_SHAPES` change) before either case is re-walked |
| R4 | honest-or-labelled | the design had no arm for the recorded sequence (collector before lookup); "lookups run first" named no actor; and the typed ask could be raised only at a before-tool moment — i.e. when the model proposes a FURTHER tool after the empty lookup — so it fired on the guessing model and never on the honest one, which asks in prose (no tool, no pause, no row); § 8.4's "asks after the placing lookup" was not derivable | the pre-lookup deny arm (R1) names the actor's next door; the ask is raised where the honest sequence reaches it — inside the last candidate lookup, by `requestInput` with `absence` (R10); § 8.4 re-derived from the design as written, with the iteration cost stated; the after-tool ask arm is named and not taken (question 15) |
| R5 | honest-or-labelled | (alias-006, the ask side) the typed ask with enum options would have fired in no recorded sequence — all five arms asked in prose with zero collectors, and a model that instead called a collector on `SHISOLPLPAP006` would have either resolved the subject by rule or left the predicate false; the rule also read `\|matches('006')\| ≥ 2` off a rowset the host never declared (the row then said "0 of 90 catalog tools declare `resultKind` / `resultColumns`" — wrong on `resultKind`, which 82 declare as an artifact-kind label; right in effect, because no reader treats the host's wrapper as rows — § 15, R3-P1) | "form 1" wording dropped for the case; the tool counts its own rows and hands back `semantic({ clarify })` or raises `requestInput` — no rowset declaration needed for that; the host's rowset shapes are required in the same step as any rule that reads them (§ 5.5, rule order) |
| R6 | honest-or-labelled | H3's replacement reader was mis-keyed: `evidence_checked { action: 'revision-asked' }` means the LIBRARY sent unsupported values back to the MODEL (a guard revision can be a re-worded guess), and an honest prose ask outside a revision had no row under the design — the metric would have reported behaviour change by construction; the '?' regex already scored vm-perf-on-array A's guess-plus-question as an ask | "asked" is scored from the REPLY in both conditions by hand, the typed ask is a separate column read from `pause.request … awaitingInput`, `revision-asked` is never an ask, and "guess + trailing question" is false-known |
| R7 | honest-or-labelled | the proposed deny sentence was a pure absence statement ("no result names it; the inventory found no name matching it") with no coverage boundary — the shape the recorded model turned into "not in the collected estate … decommissioned" while its envelopes carried `notChecked: 'whether the cluster exists at all'`; the library's own recovery frame invites the same shape ("an honest 'that was not collected' is a correct answer"); the cited deny precedent scripts the model, and the retained records hold zero deny rows | every library-composed deny on an unplaced subject carries the typed coverage boundary and the declared next door (a join, never inference); `buildEvidenceCorrection`'s clause is reconciled in the same release (§ 10 change 7); post-deny recovery is measured (§ 8.2). STILL NEEDS: the measurement — no honest recovery from a deny is on any record. **Narrowed in round 3 (§ 15, R3-2 / R3-6):** "every deny carries the coverage boundary" over-promised — the PRE-lookup arm has no envelope to quote and no static declaration to read, so it carries the placement rule and the lookups only; the boundary rides the remaining-lookups arm, from envelopes |
| R8 | honest-or-labelled | "every declared placing lookup came back empty" was under-specified: EVERY would cost a `read_skill` switch per estate (the host admits collectors only under their owning skill, `read_skill` alone per switch — arm D's ten-iteration $0.34 shape) and § 8.4's "not above arm E's cost" could not hold; ANY would ask after the PowerScale inventory while the VM lookup that places `epic-cache-07` never ran; and most lookups return bare wrappers, so the trigger could not be satisfied in step 3 at all | the rule is keyed on the subject's `candidateKinds` and the lookups declared for THOSE kinds; the model switches skills reading the deny, one iteration per candidate estate; "ask after the LAST candidate lookup" is the pinned law; the host declares envelopes on exactly those lookups in step 3; the cost hypothesis is re-derived (§ 8.4). **Corrected in round 3 (§ 15, R3-7 / R3-P4):** "the app knows which lookup is last" was wrong — last is a run fact the tool cannot see, now a library fold on `ToolExecutionContext.placement`; and the flagship shape is multi-candidate, so the cost is up to seven iterations, not five |
| R9 | facts | the AgentSpec row cited a `before_action` / `after_action` / `agent_finish` trigger set; the paper's grammar is `state_change \| before_action \| agent_finish \| DomainSpecificEvent` and "after_action" appears nowhere in it | the row quotes the grammar; `before_action` ≈ before-tool, `agent_finish` ≈ Route, and the after-tool moment has no AgentSpec twin (`state_change` is the nearest; the paper's after-observation hook is `AgentStep`) |
| R10 | design | form 1 was a second owner of a door that exists and is better placed: `requestInput` IS a pause resumed with typed values, raised from the tool that came back empty, its answer reaching the model as that tool's own `InputResponseResult`; the settlement form 1 needed four reader changes, the batch fix and capability 1's resume door to define was already there; the pause is already on the record whole (`pause.request.questionPayload` = the entire `pauseData`), so `clarify_asked` would have been a second row; `SemanticClarify` was missing from § 4 | form 1 dropped; the ask is `requestInput` from the last candidate lookup, gaining ONE field — `InputRequestDeclaration.absence?: AbsenceDeclaration`; `clarify_asked` / `clarify_answered` withdrawn; the bench reads `pause.request … awaitingInput` and `tools.semantics_declared.semantics.clarify`; `semantic({ clarify })` added to § 4 (fifteen mechanisms); capability 1 is no longer a prerequisite of the ask path; § 10 change 1 rewritten. **Corrected in round 3 (§ 15, R3-8 / R3-9):** "one field" was not earned — the declaration's opaque `context` slot carries an absence today — until a library READER files it as observed; the field now comes with that reader, and the asking lookup's miss is on the record as `tools.absent` before the pause |
| R11 | design | three reasons (`subject-unresolved`, `argument-kind-mismatch`, `skill-declared-incompatible`) required the library to read the host's resolver shape out of `given`, which capability 1 defines as an opaque `unknown` — business logic read by the hosting layer, a shape inferred rather than declared; no placement type existed | interface + adapter: a library-owned `SubjectPlacement { subject, status, kind?, rule?, candidateKinds? }` through a `placements` provider port on the `externalGrounds` pattern; the library compares `argumentKinds`, `resolves` and skill declarations against THOSE rows and never against `given`; `unplaced` rows never participate (an unknown). **Corrected in round 3 (§ 15, R3-14):** the port stays, the TYPE goes — a placement is a ContextFootprint `Assertion` with a `Claim` value, and `participates()` / `conflictsOf` already give the semantics the type re-specified |
| R12 | design | the step-1 rule re-filed a model-declared `ruled-out` standing as `open` — a second writer of the MODEL's word `standing`, the one-owner breach F11 had corrected; `serve.ts` would have served a standing the model never declared; the cited 9.110.0 precedent (`ContingentRow`) is a SEPARATE row kind, never a rewrite | a separate derived row kind (`'unsettled-by-absence'`, name open) filed through `recordFindings` beside the standing, keyed to its `toolCallId`; the model's row is untouched and served as declared; the step-1 test asserts the `ruled-out` row is byte-identical |
| R13 | design | (alias-006, the data side) "two names as enum options" needed a cross-measurement join (a cluster row vs a SyncIQ target field) that no declared rowset rule expresses; the page had copied the bench's `why` sentence as fact | § 2 re-written from the seed; the honest lookup result is a `known` placement plus a second fact from the SyncIQ rows, sayable via `semantic({ facts, clarify })` from the inventory tool (app) or a corrected oracle label (H2); the after-tool ask wording removed everywhere |

**What the design still cannot do after round 2, said plainly:** raise a typed ask from the
LIBRARY at any moment — the raiser is the app's placing lookup (`requestInput`), and the
library's whole contribution to the ask is the reason it carries and the deny that steers the
model to that lookup; state a typed question before any run (form 2 — app work or a ruling);
constrain what the model does AFTER a deny, or show on any record today that it recovers
honestly from one (a bench column, not a mechanism); decide `source-not-consulted` or
`existence-not-checked` until the coverage vocabulary ships; see a miss on any host lookup that
still returns a bare wrapper (round 2 wrote "the host's 90 catalog tools declare no rowset
shape and only `pscale_cluster_inventory` reaches `absent()` on a cluster miss" — corrected in
§ 15, R3-P1 / R3-P2: 82 declare `resultKind`, which is not a rowset shape, and `af_absent()` is
minted at ~57 Python sites, just not by the case lookups); measure alias-006 until its seed or
its label is corrected; change a REPLY at Route (a label only); or hold a pause on one call of
a batch without the sibling settlement landing first.

---

## 15. Corrections from review round 3 (2026-09-23)

Fifteen blocking findings from the same four lenses, each re-verified against the code and the
recorded runs before it was applied — the library's `core/tools.ts` (`Tool`, `ToolExecutionContext`,
`defineTool`'s copy list), `core/inputRequest.ts` (`context?`, `origins`, `validateInputDeclaration`'s
key allow-list), `core/pause.ts` · `requestInput` / `pauseHere`, `stages/toolCalls.ts` (the
`isPauseRequest` branch that returns the checkpoint; `declareCoverage`, which runs on a RETURNED
value only), `core/Agent.ts` · `resume` (`input_received`, `context` passthrough),
`core/RunnerBase.ts` · `emitPauseRequest`, `stages/callLLM.ts` (`externalGrounds`, a zero-arg
provider consulted once per response), `middleware/types.ts` (the header's after-tool paragraph;
`DenyOutcome`, `MessageOutcome`, `ToolResultOutcome`, `ToolCallContext.history`, `AskPayload`),
`middleware/errors.ts` · `MessageDeniedError`, `stages/route.ts` (the three output-deny sites:
"the answer is NOT released"), `coverage/types.ts` (`AbsenceDeclaration`, `DeclaredCoverage`) and
`coverage/absent.ts` · `readAbsence`, `integrity/column-types/check.ts` · `readRowset` and
`integrity/empty-lookup/check.ts` · `readLookupResult` (top-level array only),
`lib/claim/claim.ts` · `known`, `lib/semantics/types.ts` (`SemanticFact.entity`, `SemanticClarify`),
`src/integrity/assertion/types.ts`, `src/core/agent/types.ts` (`ExternalGroundsProvider`,
`answerGuarantee`, `coverageDeclared`), `findings/{types,ledger,reserved}.ts`,
`events/payloads.ts` · `MiddlewareDecisionPayload`, `src/integrity/README.md`,
`docs/design/map-walker-trace-fold-lens.md` (the three Fold laws), the vendored
`contextfootprint/dist/esm/{assertion,conflicts}.d.ts`; the host's `py-tools/server.py`
(`real_rvtools_get_vms`, `real_pmax_get_inventory`, `real_pmax_get_sg_perf`, `real_vrops_get_vm_perf`,
`real_pscale_cluster_inventory`, the `af_absent()` helper and its ~57 call sites),
`tools-catalog.json` (`_meta.agentfootprint` on every entry), `src/catalogTools.ts` (`Extras`,
`catalogTool`'s metadata law), `src/toolBindings.ts` · `rvtoolsGetVms`, `src/pyBridge.ts` ·
`defineTool` (`usePyTools()`), `src/data.ts` · `absent` (`MockAbsence`), `src/routing/catalog.ts`
· `SUBJECT_SHAPES`, `be-server/routing.ts` (`toolMiddleware`, `subjectEvidenceCarry`, `activeInput`),
`docs/measurements/selection-arms-2026-09-23.json` (the arm-A rows for unknown-id-slow and
resolver-unknown), and the retained records `…-1790173253876` (three `tools.absent` rows with
`notChecked`; the `integrity.disposition` row; 46 `allow` / 0 `deny`) and `…-1790173415418`
(`"total":0,"returned":0,"vms":[]` with `af_provenance`; gate `grounded`; `unsupported-argument`
checked-pass). All fifteen held in substance; none was rejected; two carried imprecise evidence,
noted in their rows. The check also found five facts THIS PAGE had wrong that no finding raised
(R3-P1 … R3-P5). One line each: what was wrong, what changed, and — where the design cannot
solve the case — what it still needs.

| # | lens | was | now |
|---|---|---|---|
| R3-1 | field | the post-lookup deny ("Nothing places it; ask the person which system it is") named the wrong door in the only state it can fire: by the page's own rule the LAST candidate lookup's miss raises `requestInput`, which throws out of `execute` and returns the checkpoint, so a before-tool moment after every candidate lookup came back empty never exists; the arm was reachable only in the MIDDLE state, where "ask the person" steers the model to the premature ask the bench scores a miss. (The finding's illustration over-read the record: resolver-unknown arm A asked in PROSE at iteration 4 after `pmax_get_inventory` — it proposed no further collector — so the record reaches the middle state and then a Route-only turn; the mechanism holds by construction either way) | the arm is replaced by a REMAINING-LOOKUPS arm: the empty envelopes quoted verbatim plus the candidate lookups not yet run (the `resolves ∩ candidateKinds` join minus this turn's calls); "the person" appears only in the last lookup's app-composed `requestInput.question`; the page states that the all-empty state has no before-tool sentence because it pauses (§ 5.5 Correct; § 6.2 case 2; § 10 change 10) |
| R3-2 | field | the pre-lookup deny's third clause ("existence was not checked by anything yet; the collectors you proposed read collected samples, not whether it exists") had no row at the moment it is composed — the collectors are denied and never run, so no `absent()` envelope exists; `argumentKinds` was step 4; and `Tool` has no static coverage field — so the clause was composed from nothing and R7's "carries the typed coverage boundary" was not derivable in step 3 | the clause is CUT; the step-3 pre-lookup sentence has two clauses (the placement rule, the candidate lookups) and is registered as such; a definition-time coverage declaration that could restore it is open question 18, not a thing step 3 composes; R7's row is narrowed (§ 5.5; § 14 R7; § 11 Q18) |
| R3-3 | field | the HIT side of a placing lookup was never declared: step 3 moved the measured lookups to `absent()` on a MISS only, so on resolver-unknown the correct lookup-then-answer turn arrived as the bare `{ total, returned, vms }` wrapper — neither a miss nor a declared rowset, a state the rule order never defined — leaving the subject unplaced (the next collector denied, the correct answer labelled `unknown`). (The finding's catalog evidence was wrong — `resultKind` is on 82 of 90, not 0 — but that changes nothing: R3-P1) | step 3's app half declares the HIT on exactly the measured lookups — `semantic({ facts: [{ entity }] })` with one fact, or a top-level array under `resultColumns`; N ≥ 2 rows (the `LIKE` substring match) is `semantic({ facts, clarify })`, never a placement — and the rule order gains the third state "ran, undeclared ⇒ `not-applicable`, silent, a lens line" (§ 5.2 `resolves`; § 5.5 "What counts as a hit"; § 9 step 3) |
| R3-4 | field | G7's "or an output `deny` when 'checked' appears with no receipt row" reintroduced the F2 collision: an output-phase message deny is `MessageDeniedError` at the API boundary and discards the whole answer (`stages/route.ts`: "the answer is NOT released"), on the model-chosen door where § 6.1's own rule forbids a turn-ending refusal, and "when 'checked' appears" is a string match over prose | struck from G7 and from § 6.3's capability-3 row; the claim is protected by the gate, a typed carrier (`.claims()` or the `_findings.answer` ride-along) and the `value-unchecked` label; a Route-moment refusal on door (c) is named as the F2 shape (§ 6.1 G7; § 10 change 15) |
| R3-5 | honest-or-labelled | the person's typed answer never placed the subject: only a declared lookup's `observed` row extinguished `subject-unresolved`, the `placements` provider is a zero-arg function read from the app's own state, and nothing re-read the pause answer into it — so after "a storage client of SHISOLPLPAP006" the honest next collector was keyed on a span still unplaced and the (struck) post-lookup arm told the model to ask again; and without `argumentKinds` "keyed on" was a string match | the FOLD derives an `answered` placement assertion from the `input_received` row when the request carried `absence` and the `kind` field was a declared enum over `candidateKinds ∪ 'not-in-this-estate'` (a `string` answer places nothing; `'not-in-this-estate'` closes the subject); both arms and `subject-unresolved` read participation on the key; `argumentKinds` is pulled into step 3 so both arms fire only on an argument whose declared kind ∈ `candidateKinds` (§ 5.1; § 5.3; § 5.5 settlement; § 10 change 13). STILL NEEDS: the rank of `answered` against `given` on a disagreement (Q19) |
| R3-6 | honest-or-labelled | the same clause as R3-2, from the other side: the step-3 deny the page shipped was the bare-absence shape R7 said the model turns into "decommissioned"; the "keyed on" predicate had no declared kinds; and the seam between predicate and sentence (app middleware or library) was unnamed | the pre-lookup arm states NO absence (it names the rule and the lookups; nothing has run), so R7's shape does not arise there; `argumentKinds` is step 3; the seam is named — the library owns the fold and the middleware factory, the app installs it (§ 5.4 before-tool; § 5.5; § 10 changes 6 / 10) |
| R3-7 | honest-or-labelled | "ask after the LAST candidate lookup" was pinned on a raiser that cannot know it is last: which lookup is last is a run fact (the model's call order), `ToolExecutionContext` exposes no history and no prior results, the host's bindings are module-level and its resolver runs per request behind a closure (`activeInput`) — the `AsyncLocalStorage` shape capability 1 exists to retire; `tryInstead` is static and step 6 | the library folds the fact and hands it to the tool: `ToolExecutionContext.placement?.verdict === 'last-candidate'` (name open), computed by the same `placementVerdict` fold the before-tool middleware reads, counting later batch siblings as not yet run; the tool's rule is one line over that fact. The finding's own `priorCalls` alternative is NOT taken (it would make the tool a second evaluator of the placements × `resolves` join, Fold law 1) (§ 5.5 form 1; § 10 change 12). Also: the flagship is NOT a one-candidate shape (R3-P4), so "only the one-candidate flagship escapes, trivially" was too kind to the design |
| R3-8 | design | `InputRequestDeclaration.absence?` was docs, not a feature: the declaration's existing `context?` slot carries an absence TODAY — validated, on the pause record, on the checkpoint, handed back to the model on resume as `InputResponseResult.context` — and the page named no library reader that would need the new name | the field is EARNED by a named reader (R3-9); the page says why `context` cannot serve (a reader never parses an opaque slot) and that the validator's key allow-list must admit `absence` (§ 4 ask-doors row; § 5.5 form 1; § 10 change 1). Had no reader been needed, the honest answer would have been a README recipe on `context` — the page says so |
| R3-9 | design | raising the ask from INSIDE the lookup displaced its observed miss from the record: a tool that throws `requestInput` returns no value, `declareCoverage` runs only on the returned value, and on resume the call's result row is the person's values — so "rvtools_get_vms found nothing", the flagship reason's own witness, left no `tools.absent`, no `coverageDeclared`, nothing for the `CoverageBand`; and the trigger had no library evaluator. The finding proposed an after-tool `ask` arm (the header's invited case) with the tool returning `absent()` | the reader: the pause branch runs `declareCoverage` (and the `empty-lookup` seam) over the ask's `absence` BEFORE returning the checkpoint, pinned by a test that a raising lookup files the same rows as a returning one; the evaluator: the library fold (R3-7). The after-tool arm is brought as a case and RULED not needed for it on this page (Q15 closed): both goods are secured at before-tool, and the arm's settlement would need two results for one `tool_use`, a raw result on the checkpoint, a fifth resume path and a new outcome member. Applied differently from the finding's proposed mechanism, with the reason (§ 5.5 form 1 and form 2; § 11 Q15) |
| R3-10 | design | the predicate "a collector keyed on an unplaced subject" had two owners in two layers (the app's hand-written before-tool arm; the library's Route fold), the library composed a sentence for a verdict it did not evaluate, the deny carried its reason as prose only (`DenyOutcome.reason: string` → `MiddlewareDecisionPayload.why?: string`, no typed slot), and the placement rows the sentence quotes were never recorded (on the `externalGrounds` precedent only excusals are filed) | ONE owner: the exported pure fold `placementVerdict(...)`, a built-in before-tool middleware factory that calls it, the Route fold reading the same function, a typed `because: PlacementBecause` on the decision row beside `why`, and the placement assertions filed once as `agentfootprint.placements.declared` when the provider is read (§ 5.4; § 5.6; § 10 changes 8 / 10) |
| R3-11 | design | `known` was derived from silence ("`reasons` empty AND `basis.applied` non-empty") — a positive inferred from no row, against consequence 4 and law 5, borrowing `Claim<T>`'s word whose owner demands evidence (`known(value, evidence)`); on the host it labelled the flagship false-known reply "known" (the arm-A disposition: wire check 3, every content check `notApplicable`) and vm-perf-on-array A too (gate `grounded`, `unsupported-argument` checked-pass on a category error) | the row is four-valued: `known` ⇐ a SUPPORTING row (`support?`: every declared `.claims()` field `checked-pass`, or a passed enforce `AnswerValidationReport` for these bytes); `unrefuted` ⇐ checks applied, none fired, no support (rendered "consistent with the record — N checks applied, none fired", never "known"); `unknown` ⇐ a reason; `not-applicable` ⇐ nothing applied. On the host today NO chat answer can be `known`, and the page says so (§ 5.6; § 10 changes 4 / 14; § 11 Q2) |
| R3-12 | design | the same gap as R3-3 from the measurement side: step 3 could not be measured as designed on resolver-unknown, because an `observed` placement needs a declared hit and the step required only the miss | folded into R3-3's fix; § 8.2 states that label accuracy must report the bare-wrapper state as the DESIGN's miss, not the model's, until the hit is declared (§ 8.2; § 9 step 3) |
| R3-13 | design | after round 2 the person's answer had no provenance tier, so "≥ `given` to key a collector" and "a `claimed` value never reaches a hook" could not be evaluated on the flagship's resume half; § 7.1 still said the fields enter "as `given`" (round-1 text) | `'answered'` is added to `Provenance`, mapped from `AwaitingInput.origins` `'response'`, admitted for keying a collector only through a declared enum over the candidate kinds; the minimum-strength rule and § 7.1's ASPI row are rewritten (§ 5.1; § 7.1; § 10 change 13) |
| R3-14 | design | `SubjectPlacement { subject, status, kind?, rule?, candidateKinds? }` was a third app-given shape beside `ExternalGround` and `Assertion`, with its own comparison rules that the vendored `assertion.d.ts` already gives — `value` "may be a plain value or a `Claim<T>`; a non-`known` Claim never participates", `participates()`, `conflictsOf` | the port stays, the type goes: the provider yields `Assertion[]` through the library's wrapper (`subject: { kind: 'name', id }`, `predicate: 'kind'`, `value: known(kind, rule) \| unknown(rule)`, typed provenance beside the string) plus a multi-valued `candidateKinds` predicate; `subject-unresolved` = `!participates(kind)` after the candidate lookups; a `given` vs `observed` disagreement is a `ConflictRow` (§ 5.2; § 10 change 8; § 14 R11) |
| R3-15 | design | `AnswerAssessmentRow.shape?` (= `answerGuarantee`) and `declared?` (= the model's `_findings.answer` standing) copied two owned facts onto a sibling field of the same state object — the second-writer shape Fold law 2 forbids ("never stored beside the Trace"), while the page cited the law | both fields dropped; the fold reads `AgentState.answerGuarantee` and the ledger's answer-level standing (via `recordFindings`'s rows) at render time, and the lens draws them beside the chip (§ 5.6; § 10 change 14) |
| R3-P1 | (page fact) | "the host declares NEITHER `resultKind` nor `resultColumns` on any of its 90 catalog tools" (§ 5.5, R5, Sources) and `zero-not-absence` fenced to "a `resultKind` / `resultColumns`-declared rowset" | 82 of 90 carry `resultKind: 'dataset/rows'` in `_meta.agentfootprint`, spread into `defineTool` by `catalogTool`; 7 carry `argumentsFrom`; 0 carry `resultColumns`. It changes no verdict: `resultKind` is the artifact kind an oversized result is minted under for `wants` matching (`Tool.resultKind`'s own doc) and names no key that holds rows; `readRowset` / `readLookupResult` read a TOP-LEVEL array only, so the `{ total, vms }` wrapper is invisible to every check even with `resultColumns`. `resultKind` is removed from every fence on the page |
| R3-P2 | (page fact) | "only `pscale_cluster_inventory` reaches `af_absent` through `_ps_absent_cluster`" | the Python `af_absent()` helper is called at ~57 sites in `server.py` (the retained record itself holds three such envelopes from `pscale_op_latency` / `pscale_events` / `pscale_jobs`); what is true and specific is that `real_rvtools_get_vms`, `real_pmax_get_inventory`, `real_pmax_get_sg_perf` and `real_vrops_get_vm_perf` call it nowhere, and `real_pscale_cluster_inventory` once |
| R3-P3 | (page fact) | "the host uses `absent(` in four files (`src/data.ts`, `src/toolBindings.ts`, `src/subject.ts`, `be-server/brain.ts`)" counted as the library's envelope | `src/data.ts` · `absent` returns `MockAbsence { not_found: true, count: 0, query, mock_data_covers, note }` — the offline mock's own shape, which `readAbsence` does not read; `src/toolBindings.ts` · `rvtoolsGetVms` returns it on a miss ONLY when `pyBridge.ts` · `usePyTools()` is false; the bench ran the Python backend (the record holds the bare wrapper with `af_provenance`). Step 3's change site is the Python server; the TS mock follows if the offline path is ever measured |
| R3-P4 | (page fact) | "a one-candidate shape (`shHost` → VM) … two iterations beyond arm A's three" (§ 5.5, § 8.4, R8) | `SUBJECT_SHAPES.shHost` "also matches every estate device name … for an application server it is the only rule": a residual SH… name no estate rule placed is MULTI-candidate (VM, ESXi host, physical storage client — arm E's question), its candidate lookups sit under at least two skills, and the cost is up to seven iterations before the ask. § 5.5, § 8.4 and step 3's resolver adapter are corrected |
| R3-P5 | (page fact) | new declarations (`resolves`, `argumentKinds`, `resultColumns`, `absence`) were placed on `defineTool` and `requestInput` as if the host and the validator would take them as written | two build constraints, now named: `validateInputDeclaration` refuses unknown keys (`id`, `question`, `fields`, `supplied`, `context` only), so `absence` is an allow-list change; and `catalogTool` refuses any TS-side override of schema or metadata, so every per-tool declaration on the host must ride the generated Python catalog's `_meta.agentfootprint` and an extended `src/catalogTools.ts` · `Extras` pick |

**What the design still cannot do after round 3, said plainly:** raise a typed ask from the
LIBRARY at any moment — the raiser is still the app's placing lookup (`requestInput`), now on a
library fact and with a library reader, and the library composes no question; make the model
RUN the remaining candidate lookups — a model that answers or asks in prose with candidates
remaining meets no verb (no tool call, no moment) and is labelled at Route and scored by hand
(the recorded resolver-unknown arm A is that turn); state a typed question before any run
(form 2 — app work or a ruling); constrain what the model does AFTER a deny, or show on any
record today that it recovers honestly from one (a bench column, not a mechanism); say `known`
of any answer on the host today (prose, no `.claims()`, no `answerValidation` — every host
answer tops out at `unrefuted` until a typed carrier is armed); decide `source-not-consulted`
or `existence-not-checked` until the coverage vocabulary ships; put the coverage boundary in
the PRE-lookup deny (no row before the collectors run — Q18); see a miss OR a hit on any host
lookup that still returns a bare wrapper (the Python case lookups do; the TS mock's
`MockAbsence` is not the library's envelope either); rank `answered` against `given` on a
disagreement (Q19); measure alias-006 until its seed or its label is corrected; change a REPLY
at Route (a label only); or hold a pause on one call of a batch without the sibling settlement
landing first. And, said once more because round 2 said the opposite: step 3 is not "one
field" — it is one fold with three readers, one port, one context fact, one field with its
reader, one tier, two sentences with a typed slot, one event and the batch settlement.

---

## Sources

- **The library** (this repository, agentfootprint 9.112.2): every `file · symbol` above; the two sibling design pages; `src/integrity/README.md`;
  `src/core/agent/{evidence,findings,coverage,middleware}/README.md`;
  `docs-next/content/docs/build/loop-moments.mdx`.
- **The host** (a separate private repository; `host:` paths above are relative to it):
  `be-server/protectedAnalysisFlow.ts`, `be-server/protectedAnalysis.ts`,
  `be-server/vmInventoryFacts.ts`, `be-server/brain.ts` · `BE_EVIDENCE`,
  `be-server/routing.ts`, `src/routing/{subjects,compatibility,declarations,shadow,router,
  cascade}.ts`, `scripts/bench/{selection-arms,selection-observe}.ts`,
  `docs/measurements/selection-arms-2026-09-23.json`, `py-tools/server.py`, host commits
  `bfd4e35`, `05b7a2c`, `1a94f98`, `be9c9c9`.
- **ContextFootprint**: the host's vendored `node_modules/contextfootprint` (0.1.0: README,
  `dist/esm/assertion.d.ts`, `conflicts.d.ts`); the library's dependency 0.1.1.
- **Local material not in any repository**: the guard behaviour map and synthesis (workflow
  journal `wf_7f50eef5-7cd`, entries 2 and 26); the live bench logs of 2026-09-23 (the
  session scratchpad, `live/`); the second design line's two documents of 2026-09-22
  (skill-selection evidence design and handoff); the owner's memory notes on the field report
  (2026-08-29), the skill-selection plan, the declared-control gap and the canon.
- **External**: cited inline in § 7 with venue and arXiv id; the two classical records marked
  "record only" were not opened beyond their bibliographic entry. The two policy-engine pages
  of § 7.2 were re-opened for the review round: https://aws.amazon.com/blogs/security/why-policy-in-amazon-bedrock-agentcore-chose-cedar-for-securing-agentic-workflows/
  and https://ai-sdk.dev/docs/agents/policy-tool-approvals.
- **Review round 1** (2026-09-23): the four lenses' fifteen findings, each re-verified before
  it was applied against `src/core/agent/stages/toolCalls.ts` (the ask branch, the four resume
  paths, `appendBatchResult`), `src/core/pause.ts` · `pauseDemandsDecision`, `src/core/Agent.ts`
  · `resume`, `src/core/RunnerBase.ts` · `detectPause`, `src/core/inputRequest.ts`,
  `src/hosting/{admission,types}.ts`, `src/core/agent/coverage/{types,absent}.ts`,
  `src/events/payloads.ts` · `ToolAbsentPayload`, `src/core/agent/stages/{route,answerValidation}.ts`,
  `src/core/agent/types.ts` · `answerGuarantee`, `src/core/agent/findings/types.ts`,
  `src/lib/claim/claim.ts`, `src/integrity/assertion/{types,conflicts}.ts`,
  `src/adapters/llm/AnthropicProvider.ts`, `src/core/agent/window/types.ts`; the host's
  `.dev/selection-arms-2026-09-23-1790173253876/events.ndjson`,
  `…-1790173370529/routing-shadow.ndjson`, `tools-catalog.json`, `src/routing/cascade.ts`,
  `scripts/bench/selection-{questions,observe}.ts`, `docs/measurements/selection-arms-2026-09-23.json`,
  `be-server/{metricsProvider,vmInventoryFacts}.ts`; and both `contextfootprint` dist trees
  (`diff` of `dist/esm`).
- **Review round 2** (2026-09-23): the four lenses' thirteen findings, each re-verified before
  it was applied against the retained records `.dev/selection-arms-2026-09-23-{1790173253876,
  1790173370529, 1790173415418}/events.ndjson` (the ordered `tool_start` / `tools.absent` /
  `route_decided` / `evidence_checked` / `turn_end` events; a sweep of every retained record for
  `middleware.decision { outcome: 'deny' }` — none) and every retained `routing-shadow.ndjson`
  row; the host's `py-tools/seed/influx/11-powerscale.lp` (`ps_cluster` rows by tag;
  `SHISOLPRNAP006` occurrences), `py-tools/server.py` · `real_rvtools_get_vms` /
  `real_pscale_cluster_inventory` / `_ps_absent_cluster`, `src/data.ts` · `PSCALE_CLUSTER` /
  `sameName`, `src/toolBindings.ts` · `pscaleClusterInventory`, `tools-catalog.json` (the
  lookup parameters; the round-2 count "`resultKind` / `resultColumns` on 0 of 90 tools" was
  wrong on `resultKind` — 82 of 90 carry it in `_meta.agentfootprint`; § 15, R3-P1), `be-server/routing.ts`
  (`collectors`, the `read_skill`-alone admission, `subjectEvidenceCarry`),
  `src/routing/catalog.ts` · `SUBJECT_SHAPES`, `scripts/bench/selection-{questions,observe}.ts`
  (`asksUser`, `judgeTurn`, the case labels), `docs/measurements/selection-arms-2026-09-23.json`
  (the per-turn verdicts and replies), `tests/be-server-vm-analysis-correction.test.ts`; the
  library's `src/core/agent/middleware/types.ts` (header; `MessageOutcome`,
  `ToolResultOutcome`), `src/events/payloads.ts` (`evidence_checked.action`,
  `PauseRequestPayload`, `PauseResumePayload`, `ToolSemanticsDeclaredPayload`),
  `src/core/agent/evidence/gate.ts` · `buildEvidenceCorrection`, `src/core/agent/evidence/
  README.md`, `src/core/pause.ts` · `requestInput`, `src/core/inputRequest.ts`,
  `src/core/agent/stages/toolCalls.ts` (the `requestInput` pause path), `src/core/Agent.ts` ·
  `resume` (`input_received`), `src/core/RunnerBase.ts` · `emitPauseRequest`,
  `src/lib/semantics/types.ts` · `SemanticClarify`, `src/core/agent/findings/{types,ledger,
  contingent,serve}.ts` and README, `src/core/agent/types.ts` · `ExternalGroundsProvider` /
  `ExternalGround`, `src/core/agent/coverage/{types,absent}.ts`, a `grep` of `src/` for any
  placement type (none), `docs/design/2026-09-declared-control.md` (`AgentRunOptions.given?:
  unknown`); and the AgentSpec HTML full text (https://arxiv.org/html/2503.18666, the Event
  and Enforce productions of Figure 3).
- **Review round 3** (2026-09-23): the four lenses' fifteen findings, each re-verified before
  it was applied against the sources listed at the head of § 15 — in the library
  `src/core/tools.ts` (`Tool`'s declaration fields, `ToolExecutionContext`, `defineTool`'s
  copy list, `Tool.resultKind`'s and `Tool.resultColumns`'s own docs), `src/core/inputRequest.ts`,
  `src/core/pause.ts`, `src/core/agent/stages/toolCalls.ts` (the `isPauseRequest` branch;
  `declareCoverage`), `src/core/Agent.ts` · `resume`, `src/core/RunnerBase.ts`,
  `src/core/agent/stages/{callLLM,route,seed}.ts`, `src/core/agent/middleware/{types,errors}.ts`,
  `src/core/agent/coverage/{types,absent}.ts`, `src/integrity/{column-types,empty-lookup}/check.ts`,
  `src/integrity/unsupported-argument/check.ts` · `ExternalGrounding`, `src/integrity/assertion/types.ts`,
  `src/lib/claim/claim.ts`, `src/lib/semantics/types.ts`, `src/core/agent/types.ts`,
  `src/core/agent/findings/{types,ledger,reserved}.ts`, `src/events/payloads.ts`,
  `src/integrity/README.md`, `test/modelFacingSurfaces.test.ts`,
  `docs/design/map-walker-trace-fold-lens.md`, `docs/design/2026-09-declared-control.md`;
  the host's `node_modules/contextfootprint/dist/esm/{assertion,conflicts}.d.ts`,
  `py-tools/server.py` (the five case lookups; the `af_absent()` helper and a count of its
  callers), `tools-catalog.json` (`_meta.agentfootprint` on all 90 entries: `resultKind` 82,
  `argumentsFrom` 7, `resultColumns` 0), `src/{catalogTools,toolBindings,pyBridge,data}.ts`,
  `src/routing/catalog.ts` · `SUBJECT_SHAPES`, `be-server/routing.ts`,
  `docs/measurements/selection-arms-2026-09-23.json` (`rows[]` · the arm-A rows for
  unknown-id-slow and resolver-unknown, with their `facts`, `verdict` and `reply`), and the
  retained records `.dev/selection-arms-2026-09-23-{1790173253876,1790173415418}/events.ndjson`
  (`tools.absent`, `integrity.disposition`, `middleware.decision`, `evidence_checked`, the
  `rvtools_get_vms` result bytes).
