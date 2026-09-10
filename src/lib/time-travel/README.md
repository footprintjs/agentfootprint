**Fold** — where a reader of a finished agent run is allowed to stop, and what
the model was handed at each of those stops. `milestoneStops.ts` derives the
positions and `servedView.ts` rebuilds the request, both from the recorded
commit log and nothing else: no event, no recorder, no re-walk of the chart.

# time-travel — the agent's stops on the reader's cursor

footprintjs 9.17 ships the cursor itself. `timeTravel(snapshot)` opens a
read-only position over a finished run, with a fold at every stop, and takes a
`TimeTravelStrategy` that says where the stops are. The one strategy it ships,
`commitStops`, puts a stop on every executed stage — the only grammar the
substrate knows, because the engine stamps one `runtimeStageId` per stage and
has never heard of an LLM turn.

agentfootprint has heard of one. `conventions.ts` · `milestoneFor` has
classified a local stage id into a **milestone** —
`iteration` · `slot` · `llm-turn` · `tool-call` · `decision` — for several
releases: a pure function over an id, no event, no hot path. What was missing
was the join. Every consumer that wanted a milestone slider mapped that
classifier onto commits itself, which meant the agent's own vocabulary arrived
at each reader slightly differently. `milestoneStops` is that join, written
once, on the seam the port opened.

```ts
import { timeTravel } from 'footprintjs/trace';
import { milestoneStopsStrategy, milestoneOf } from 'agentfootprint';

const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });

cursor.stops.map((s) => `${s.label} (${s.meta?.kind ?? s.kind})`);
// `s.meta` IS the milestone — `milestoneOf(s)` reads the same slot.
// The whole axis of a two-turn run, measured (examples/observability/23-…):
// ['Run start (start)',
//  'Iteration (iteration)', 'System prompt (slot)', 'Messages (slot)',
//  'Tools (slot)', 'LLM turn (llm-turn)', 'Route (decision)', 'Tool call (tool-call)',
//  'Iteration (iteration)', 'System prompt (slot)', 'Messages (slot)',
//  'Tools (slot)', 'LLM turn (llm-turn)', 'Route (decision)',
//  'Run end (end)']
// 42 commits → 15 stops. Note the slot stops: a turn is assembled before it is made.

cursor.jumpTo('call-llm#19');       // turn 1 of that same run
cursor.changedSince();              // the keys that turn wrote
cursor.stateAt().state.currentSkillId;  // 'alpha'
```

## What it reads / what it writes

Reads a `commitLog` (a run's) or a `history` (a subflow's own), plus the
`executionTree` when the caller has one — that is what makes a mount stop say
`kind: 'mount'` instead of being guessed from bundle shape. Writes nothing. It
is a pure function of a recording; a stored JSON snapshot behaves exactly like
a live one.

## The three rules

### 1. Composed from the per-stage axis, never re-derived

`milestoneStops` is one expression over the port's own stop grammar:

```ts
filterStops<Milestone>(commitStops(commitLog, executionTree), (stop) => {
  const m = milestoneFor(stop.runtimeStageId);
  return m ? { label: m.label, meta: m } : null;
});
```

The hard parts of that axis are already solved upstream and are deliberately
not repeated here: **one stop per `runtimeStageId`, at its first commit** (a
subflow mount commits twice, a parallel fork child commits twice and siblings
interleave — every repeat after the first is an empty bundle), the mount set
read off the execution tree, the `'start'` / `'end'` bookends, and the id-less
leading commit that carries a subflow's `inputMapper` seed. A second
implementation of that collapsing would be a second chance to disagree with the
library about what a stage is.

**Why a filter and not a loop (9.89.0).** Until 9.88.0 this file also carried
its own bookend guard, its own re-partition loop, and a `milestoneOf` that
re-ran the classifier at every read — because footprintjs 9.17's `Stop` had no
slot for a consumer's vocabulary and the `[start, …stages, end]` shape was not
stated anywhere the type could see. footprintjs 9.18 stated it once
(its `splitAxis`, in its own `axis.ts`) and shipped `filterStops` as the composition over it,
with `Stop.meta` for the vocabulary and `Stop.prologue` for the absorbing
start. Two consumers had re-derived all three by hand against 9.17; this was
one of them. Now the ONE owner of the axis contract is the library that returns
the axis, and the strategy here can only say which stages it keeps. The axis a
9.88.0 consumer scrubbed is byte-for-byte the axis it still scrubs —
`test/lib/time-travel/milestone-stops-equivalence.test.ts` drives a verbatim
copy of the 9.88.0 implementation over every recorded fixture and asserts
agreement on every stop and every fold; the only differences are `meta` and
`prologue`, and both are asserted present and right.

### 2. A stage that classifies `null` folds into the stop before it

Not every stage is a place a person would scrub to. `seed`, `pick-entry`,
`window`, the cache plumbing — `milestoneFor` returns `null` for all of them,
so they get no stop. Their commits still happened, so each kept stop's
`lastCommitIdx` stretches to just before the next kept stop begins, and the
commits before the FIRST milestone belong to `'start'`. Nothing is orphaned;
`stateAt(stop)` stays exactly "the state that existed when the next milestone's
stage started". On a drilled cursor that makes `'start'` read as "what this
subflow began with, after its plumbing ran".

**What that costs `'start'`, said plainly.** On footprintjs's own axis `'start'`
is the fold BASE — the state before any stage ran, which no commit index can
otherwise reach. Here it also absorbs everything that ran before the first
milestone, and a real agent seeds a couple of dozen keys in `seed` first. So
`stateAt(start)` on this axis is *the state the first milestone read*, not the
run's raw base, and a renderer keyed on `kind === 'start'` to show "what the run
began with" is showing post-seed state. Measured on a two-turn `dynamic` run:
footprintjs's `'start'` folds commits `-1..-1` and 0 keys; this one folds
`-1..0` and 32. That is the right answer for an axis whose stops must still
partition the log, and the wrong thing to assume from the `kind` alone — so
since 9.89.0 the start SAYS so: it carries `prologue: true` whenever it absorbed
a stage (footprintjs 9.18's flag, set by `filterStops`), and a renderer that
means "before anything ran" checks `kind === 'start' && !prologue`. On an axis
where the first stage IS a milestone the flag is absent, and the start is the
raw base it always was.

```ts
const start = cursor.stops[0]!;
start.kind;      // 'start'
start.prologue;  // true — `seed` and the plumbing ran before the first Iteration
cursor.stateAt(start).state.userMessage; // 'go' — already seeded
```

**A log with no milestones in it at all.** A non-empty log the classifier
recognises nothing in — a non-agent footprintjs chart handed this strategy —
yields the two bookends and nothing between them: `'start'` folds the whole log,
`'end'` folds the whole log, and `jumpTo` any stage id refuses with
`reason: 'miss'`. That is the truthful shape for a run with no milestones. It is
NOT the empty `[]`, which says something else — that the log itself was empty.

### 3. It does not know which log it was given

The classifier reads the LOCAL segment of a stage id, so `sf-llm-call#3` on an
outer log and `sf-llm-call/call-llm#7` on that mount's inner history are both
classified without the strategy being told which one it holds. One strategy
therefore serves the outer cursor and every drilled one — see the two shapes
below.

## The receipt at the stop

An llm-turn stop is where a person actually stands when they ask the question
this library exists for: *what did the model read, right here?* Until 9.88.0 the
honest answer was "most of it". The request a provider receives is **assembled
from committed pieces and never itself committed** — the call-llm bundle holds
the response, not the ask. The pieces are all on the record
(`systemPromptInjections`, `history`, `dynamicToolSchemas`, `cacheMarkers`,
`wrapUpAsked`), but the assembly rules that turn them into a request lived in
the calling stage as locals, and a reader who wanted the request back had to
re-implement them and hope.

Two things now stand at every llm-turn stop, and one law binds them.

- **`servedAt(source, epoch)` — the SERVED view.** The request, rebuilt from the
  committed pieces by the same functions the stage used on the way out.
- **`receiptAt(source, epoch)` — the RECEIPT.** Hashes and references only,
  written by the call itself immediately before the provider was invoked.

```
hash(servedAt(k)) === receiptAt(k).hash
```

When they agree, the record is complete: everything the model read is derivable
from the trace. When they disagree, something reached the model that the run
never wrote down — a defect in the record, not in the check.

```ts
import { receiptAt, receiptHash, servedAt } from 'agentfootprint';

const snapshot = agent.getSnapshot()!;

const view = servedAt(snapshot, 1)!;
view.system.text;                 // the joined system prompt, as sent
view.messages.asSent.length;      // the turns that went out
view.messages.requestOnly;        // lines written to no history (the nudge)
view.tools.names;                 // ['read_skill', 'lookup', 'skip_step']
view.gaps.map((g) => g.gap);      // ['cache-transform']

const receipt = receiptAt(snapshot, 1)!;
receipt.tools.withheld;           // 'wrap-up' on the out-of-budget call
receipt.basis.model;              // the model that answered

// the law
receiptHash(receipt.basis.runId, view.system.text) === receipt.system.hash; // true
```

### Verify from outside — the three digest halves

A reader that holds a served view and a receipt can prove every row of the
receipt without this package's internals, because the three digest rules the
receipt was minted with are exported beside `receiptHash`. Each takes exactly
the object a served view already holds:

| receipt row | served object | digest input |
|---|---|---|
| `system.hash`, `system.pieces[i].hash` | `view.system.text`, `view.system.pieces[i].text` | the text itself |
| `messages.entries[i].hash`, `messages.requestOnly[i].hash` | `view.messages.asSent[i]`, `{ role, content: text }` | `messageDigestInput(message)` |
| `tools.schemaHashes[name]` | `view.tools.schemas[i]` | `toolDigestInput(tool)` (9.89.0) |

```ts
import { receiptAt, receiptHash, servedAt, messageDigestInput, toolDigestInput } from 'agentfootprint';

const view = servedAt(snapshot, 1)!;
const receipt = receiptAt(snapshot, 1)!;
const hash = (input: string) => receiptHash(receipt.basis.runId, input);

hash(view.system.text) === receipt.system.hash;                                  // true
view.messages.asSent.every((m, i) => hash(messageDigestInput(m)) === receipt.messages.entries[i].hash); // true
view.tools.schemas.every((t) => hash(toolDigestInput(t)) === receipt.tools.schemaHashes[t.name]);       // true
```

**Why `toolDigestInput` exists (9.89.0).** 9.88.0 exported the first two rules
and a consumer could prove everything the model was served except the tools'
schemas: the receipt hashed each schema through a serializer the barrel did not
export, so a consumer's schema rows could never read Verified — its only
options were to copy the serializer (a second owner of the rule, which drifts
the day the digest gains a field, as the message digest did in 9.88.0) or to
leave the rows unchecked. The helper is the ONLY spelling of the schema rule:
`buildReceipt` calls it too. It takes an `LLMToolSchema` — the tool as handed
to the port, which is what `servedAt(k).tools.schemas` reads back — never a
`Tool` definition, which carries `execute` and other fields the model never
saw. A schema JSON cannot express (a `BigInt`; a cycle) digests to the
`UNSERIALIZABLE` mark on both sides and never throws — the `BigInt` is the
worked example: a cyclic schema is refused by footprintjs's `deepEqual` in the
subflow outputMapper before any receipt is minted under `dynamic-grouped`, a
substrate limit rather than a hole in the rule. A forced answer tool is
in `schemaHashes` and NOT in `schemas`; its body is the declared
`forced-tool-schema` gap, so there is no row to check and nothing to claim.
`stableJson` stays off the root barrel on purpose: `hash(stableJson(tool))`
would be the rule written a second time.

`epochAt` / `epochLocations` are the one owner of *where* an epoch's pieces
live — the run's own log under `reactMode: 'dynamic'`, the turn's inner
`sf-llm-call` history under `'dynamic-grouped'`. Everything above works
unchanged in both shapes because everything above asks them.

### The receipt's three laws

**1. Hashes and references, never bytes.** A receipt records that a piece of a
given shape and size was in a given position, and nothing about what it said.
The bytes are already governed elsewhere — `recordSystemPrompt` is opt-in
precisely for this, redaction patterns scrub the committed mirror, a window
strategy decides what survives — and a receipt carrying content would quietly
reopen all three.

**2. Run-salted digests.** `hash = sha256(runId + '\u001f' + content)`, first 16
hex characters. **Hashes are not redacted**, and that is the point of the salt:
an unsalted hash of a one-line system prompt, a tool schema or a two-word user
turn is a dictionary lookup away from being read back, and a receipt travels
inside recordings. Salted per run, the same sentence in two runs has two hashes,
so a hash answers "is this the same as THAT piece of THIS run?" — the only
question the law asks — and answers nothing else. A redaction pattern therefore
does not need to (and does not) reach the receipt.

**3. No authority omissions.** A receipt never names, and never counts, what a
caller's ROLE was not allowed to see. Committed state is readable by the trace
toolpack's debugging tools, so a receipt carrying `hiddenSkillIds` — or even
"3 skills withheld" — would turn a permission decision into a leak path. A
reader that needs those ids reads them from the fold, where reading them is
governed. ATTENTION omissions are a different fact and the receipt has a place
for them (`omittedForAttention`): nobody was refused anything, the request
simply did not fit, and a reader chasing "why did it not know that?" needs to
see it — hashed, like everything else. **No chart in this library supplies it
today**, measured
on 9.88.0 in both shapes: a slot writes its budget drops to `slotCompositions`
inside its own subflow and no boundary bubbles them out, so `buildReceipt` is
never handed one. The field is on the shape because the mint is a pure exported
function a caller CAN hand the fact to. Absent means nobody recorded a drop,
never that nothing was dropped — which is why it is a key of `UNGAPPED_FIELDS`
rather than a gap, and why the hole itself is entry 9 of
`docs/design/2026-09-recorded-not-built.md`.

### Gaps: what this view cannot prove, said out loud

A rebuild that quietly omits a piece looks exactly like a rebuild that proved
the piece was absent. `servedAt(k).gaps` keeps the two apart, and every entry
names the fields it covers. **`servedAt` returns `undefined` for one reason
only — the run has no such epoch.** Anything it cannot prove about an epoch that
does exist is a named gap, never a missing view and never a confident empty one.

The catalogue is not hand-checked any more. `SERVED_GAPS` was reviewed three
times by reading it against the two shapes, and came up short all three times,
so the correspondence is now WALKED:
`test/lib/time-travel/gap-catalogue-walk.test.ts` derives every field a real
`Receipt` and a real `ServedView` carry — from the declarations AND from real
runs — and requires each one to be named by a gap or to be a key of
`UNGAPPED_FIELDS` with a written reason. It then damages a recording the way
each gap describes and requires every field that MOVES to be named by that gap
— and requires each damage to move SOMETHING, because a row that damages
nothing passes for free and two of the four did exactly that for one release.
**The table below is walked too**: its rows must match `SERVED_GAPS` kind for
kind and field for field, because a table that restates a frozen exported
constant should be checked against it rather than retyped. It was short in one
row and over-broad in another on the day it shipped.

What a green walk proves: the fields are ACCOUNTED FOR. What it cannot prove:
that the account is TRUE. A gap can name a field for a mechanism that does not
cause its absence — this release shipped two of those and a person reading the
`why` is what found them.

### The table below is LONGER than what a reader is shown

`SERVED_GAPS[k].why` — the sentence a renderer prints beside a trace — names no
mechanism at all. Not a module, not a function, not a key, not a version, not a
chart, not a strategy, not an option. It says three things: which fields it
covers, what they mean on this view for the person reading, and what to do
differently. Nothing else.

That is a REDUCTION, arrived at the hard way. Five review rounds tried to write
TRUE mechanism sentences into that constant and the rate of new falsehoods held
constant. A sixth asked one question of all ten printed sentences — *could this
become false without anyone editing it?* — and nine could, two of them being
false the day they shipped. The one that could not was the one that makes no
claim about code:

> `gaps` — "The account itself rather than a fact about the request: a gap
> naming this list would be the account excusing its own absence."

That reduction was then SOLD AS ENDING THE CLASS — a sentence with no code
claim in it cannot go false when the code changes — and a seventh round measured
that claim and overturned it. Checked one at a time against real runs, TEN of
the eleven reduced sentences still make a claim a code edit falsifies. The one
above survives because it is SELF-REFERENTIAL: it describes its own field inside
the account, not the request. The other ten cannot copy that, because a sentence
that tells a reader something USEFUL — *may be SHORT*, *absent means unknown*,
*the list is complete and the schemas are one short* — is a claim about how the
rebuild behaves, and the rebuild is code. The reduction changed the VOCABULARY
of the claims, not their CLASS.

What the reduction really buys is worth having on its own: the sentences are
short and readable, and the enumerations that went false in five rounds have
nowhere to come back through. `test/helpers/gapProseClaims.ts` enforces it by
refusing every code-shaped token and a closed list of mechanism verbs on the
printed surface — close to a whitelist, and a whitelist has no synonyms.

**What actually closes the class is a run.**
`test/lib/time-travel/gap-sentences.test.ts` drives one for every entry in the
catalogue and ASSERTS WHAT THE SENTENCE CLAIMS about the view it raises — not
that the gap fired, but that its claim holds. Each sentence is decomposed into
quoted clauses, each clause carries its own assertion, and the clauses must
PARTITION the sentence, so no word of a printed sentence sits outside a checked
claim. That is how the seventh round found a brand-new false sentence inside the
round written to end false sentences: `no-run-log` claimed its fields "could not
be fully recovered" where, measured, nothing had been lost at all. No rule
caught it. A run caught it. The one blind spot that remains is honest and small:
an assertion weaker than the clause it checks — a claim nobody wrote an
assertion for.

**The `why` column below is the DOC's version, and it may name the mechanism**,
because a doc is versioned with the code it describes and its reader can open
the file. The mechanism also lives in the comment above each entry in
`servedView.ts`, and the CAUSE — which of two things stopped a receipt being
read — is a value on the gap (`ServedGap.cause`), never a clause in prose. The
walk checks this table's KINDS and FIELDS against the constant; it checks the
prose only for the three shapes that go stale in a doc exactly as they do in a
constant (a count of causes, a benignity verdict, a "you can tell which").

| gap | fields | why |
|---|---|---|
| `no-fold-base` | `system.hash`, `system.chars`, `system.pieces`, `messages.count`, `messages.entries`, `messages.requestOnly`, `tools.schemaHashes`, `tools.names`, `tools.forced`, `tools.withheld`, `epoch` | The recording travelled without a fold base (`RuntimeSnapshot.initialState`), so anything the run inherited rather than set reads as absent — and on a RESUMED run that is most of it. **Either** base counts: the log holding this epoch's call, or the RUN log holding its build-time constants. Under `'dynamic-grouped'` those are separate logs, so a grouped recording can lose the run base alone. The COUNTS move with the things they count — a rebuild that recovered one turn of three reports one — and so does **this view's** `epoch`, because a fold that cannot read `iteration` numbers the turn by its POSITION instead. The *receipt's* `basis.epoch` is not here: it was minted live and rides in the call's own bundle, whatever the base. Re-read the run from a snapshot that carries `initialState` and the gap goes away. The printed clause used to say the view's number "may differ from the one the receipt for this turn carries" — a sentence about a receipt, printed on views that have none (a base-less `LLMCall` recording raises both gaps at once). It now says what the NUMBER means: it may be the turn's place in run order rather than the count the run kept. |
| `no-conversation-on-record` | `messages.count`, `messages.entries`, `messages.requestOnly` | This call committed neither `history` nor `messagesInjections`, so the turns that went out are UNKNOWN, not empty: an empty `asSent` is the absence of a record, never a record of absence. The request-only lines are recomposed *from* the conversation, so they are unproved with it. |
| `no-receipt-on-chart` | `basis.model`, `basis.provider`, `basis.runId`, `basis.epoch`, `params`, `cache.transform`, `cache.transformHash`, `cache.markersApplied` | No USABLE receipt was read for this epoch, so nothing on the view has been checked against what went out. (Not "none was written": the causes below differ on exactly that point, and the printed sentence used to get it wrong — it opened "No receipt was found" and closed "absent here means unrecorded", both false when a receipt WAS written and was refused.) The fields listed are carried only by a receipt; everything else is rebuilt from the log alone, UNVERIFIED. Why there is none is data rather than prose — the gap carries a `cause`. `'no-receipt-committed'`: nothing was written under the receipt key, which is what a pre-9.88 recording, a run with `recordReceipt: false` and a chart whose `call-llm` stage mints none all leave behind, and the read does not separate them. `'receipt-shape-rejected'`: something *was* written there and carries no basis, so it was refused — that one says the recording is damaged. `omittedForAttention` is **not** on this list: no chart in this library supplies it on any recording, so it is a key of `UNGAPPED_FIELDS`, not a casualty of the missing receipt. The printed sentence used to close *"their absence here is a gap in the record, never a call made without them"*, which holds for each field AS A WHOLE and fails one level down: a receipt always carries `params` and always carries a `cache.transform` verdict, and an absence INSIDE `params` — measured, `{}` on an agent that set no dials — really is a call made without one. The sentence now claims nothing about what is inside a field it cannot see. |
| `no-run-log` | `tools.names`, `tools.forced`, `tools.schemaHashes`, `messages.requestOnly` | A subtree was handed in on its own; run constants live in the run log and only there — the forced output tool's NAME, and the tool `wants` the staged-refs nudge is composed from. Losing the name also loses the `schemaHashes` row the receipt keeps under it, and the request-only line the nudge would have composed. Pass the whole snapshot to read them. **MAY, never DID** — measured on a `'dynamic-grouped'` agent with one plain tool and its `commitLog` emptied, the damaged rebuild is BYTE-IDENTICAL to the intact one: that run has no forced tool and no `wants`, so the gap costs it nothing. The printed sentence said "could not be fully recovered here" for one release and was false on exactly that view. The condition is not narrowed to the runs where it costs something because it cannot be: whether the run had a constant to lose is recorded in the log whose absence raises the gap. |
| `cache-transform` | `cache.transform`, `cache.transformHash`, `cache.markersApplied`, `system.hash`, `system.chars`, `system.pieces`, `messages.count`, `messages.entries`, `messages.requestOnly`, `tools.names`, `tools.schemaHashes` | Raised on **every** view, unconditionally — including the charts that run no cache strategy at all (`LLMCall`, the message-API charts), where it is a boundary rather than a claim that anything was rewritten. Where a strategy did run, its `prepareRequest` rewrites the request after assembly, and the strategy is CODE: the commit log holds the request it was handed and never the one it handed back. **What the receipt holds of the OUTPUT, and the printed sentence used to deny:** `cache.transform` is the verdict of comparing the two, `cache.transformHash` fingerprints the result when they differed, and `cache.markersApplied` is the breakpoints the strategy actually applied (`scope.cacheMarkers` holds the candidates it was offered — those are the inputs). "Only its inputs are on the record" shipped in the printed sentence and was false about three of its own fields on day one. What IS true: the composition fields — `system.*`, `messages.*`, `tools.*` — describe the request handed TO the strategy on both the rebuild and the receipt, so a rewrite can have moved them and nothing shows it. `params` is the exception and the one field read past the strategy: off the request the port really got. Where another gap on the same view covers one of those fields, that gap is the stronger claim. **It no longer quotes `RECEIPT_BOUNDARY`**, and being unconditional is why: that sentence opens "A receipt describes the request…" and this entry is printed on views with no receipt at all (measured — an `LLMCall` view carries exactly `no-receipt-on-chart` and this). The boundary claim is now the entry's own first sentence, in the vocabulary of a view; the QUOTE moved to `provider-defaults`, which is raised only where a receipt was read. |
| `provider-defaults` | `params` | The sampling dials are read off the request the provider PORT was handed — after the cache strategy, so a rewritten dial is recorded as the port's value. What is still past the record is the vendor: an adapter or SDK may resolve a final value the port never saw. |
| `forced-tool-schema` | `tools.schemaHashes` | Under a `'tool-forced'` output strategy the synthetic answer tool is added at assembly from a build-time schema. Its NAME is on the record, so the tool list rebuilds; its schema body is not. |

### What a reader is handed is DETACHED

A fold's answers are memoized. `keyedFold` gives the same object back for the
same question, and the forward cursor seeds every later epoch's replay from that
very object — so a reader that edited what it was handed would rewrite what a
LATER epoch reports was served, silently, and only for the readers who came
after it. **A fold result is detached, or it is not a fold.**

Everything these readers hand out is therefore deep-frozen: every
`keyedFold(...).valueAt(...)`, `receiptAt(k)`, the WHOLE of `servedAt(k)` — the
view object, its four sub-objects and all six containers, down to the pieces and
gaps they hold — and `epochLocations(...)` together with the locations on it.
Copy (`structuredClone`, a spread) before you change anything.

Two of a view's containers are also COPIES and not just frozen —
`messages.asSent` and `tools.schemas` — because those two alone would otherwise
alias the fold's memoized answers. The other four are built per call and alias
nothing; they are frozen anyway, because `ServedView` says `readonly` throughout
and a promise that holds for two containers out of six is one a reader cannot
use.

Frozen rather than cloned per read, for two reasons. Cloning per read is the
cost the forward cursor exists to avoid — it puts an O(value) copy back on
every question, on the hot path of a scrub — and freezing is what footprintjs's
own `stateAt` already does, so a caller moving between the two folds meets one
contract instead of two. Measured on the same structure, freezing is ~3.6x
cheaper than `structuredClone`ing it, and it happens once per memoized answer
rather than once per read.

What is NOT frozen is the recording you handed in. `EpochLocation.log`,
`.source` and `.runSource` point at your own snapshot, and this folder does not
lock down an object it was merely given.

### The boundary every receipt field is true at

```
A receipt describes the request as this library last saw it. Whatever handled it
after that could have changed it, and nothing on the receipt would show that.
```

That sentence is exported as `RECEIPT_BOUNDARY` so a renderer prints the
library's own wording — and it is PRINTED, so it obeys the same rule as the gap
sentences: it names no module, no function and no call. It said
`LLMProvider.complete` until 9.88.0's sixth round.

**ONE entry quotes it: `provider-defaults`**, and that is the only one that
honestly can — it is raised inside `if (receipt !== undefined)`, so a view
carrying it always has a receipt for the sentence to be about. `cache-transform`
quoted it too until the seventh round, and `cache-transform` is on every view,
so a reader of an `LLMCall` trace was told what a receipt describes beside a
view that has none.

**Where "last saw it" is**, for the reader who can open the file: `buildReceipt`
is called from `stages/callLLM.ts` with the request about to be passed to
`LLMProvider.complete` — the provider PORT. Three things sit downstream of that
call and none is on the record: a provider the consumer decorated (a
`complete()` wrapping a `complete()`), a vendor adapter's own serializer, and
the vendor's server-side defaults. This is the reason `cache.transform:
'unchanged'` is scoped to the cache strategy: a decorator that appends a system
suffix and a ghost tool leaves the receipt reading `'unchanged'`, correctly and
uselessly, unless you know where the record stops. Reproduced in
`receipt-conformance.test.ts` so the claim cannot drift back.

Four other things that *looked* like gaps are not, because the release closed
them instead: the system-prompt join is one exported function both sides call;
the wrap-up call's withholding is rebuilt from the committed `wrapUpAsked`; the
forced tool's name is committed at seed; and the staged-refs nudge — the one
model-facing line written to no history — is composed by the same pure function
from the same three committed inputs, because `seed` now records the `wants`
declarations it needs.

### What is checked, and what a green run proves

`test/lib/time-travel/receipt-conformance.test.ts` drives real agents through
both chart shapes, a skill-graph hop, a stepped skill, a parked map, a wrap-up
call, a forced output tool, a staged-refs nudge and a rewriting cache strategy,
and at every llm-turn stop checks three things: the receipt describes the
request the provider really received, the served view rebuilds it, and every
receipt field neither could prove is named in `gaps`. A mutation test drops one
committed piece from the replay and requires the law to go red naming the epoch
and the field.

It does NOT prove that the model *used* what it read. That is a different
question, and `sliceForKey` / `causalChain` are where it is asked.

### What a recording actually contains

**An agent run is not redacted.** `Agent.create(...)` has no redaction option,
and 9.88.0 shipped with a conformance case that passed one anyway — an unknown
key, silently dropped, asserting behaviour on a run that does not exist. What is
true:

- The **committed pieces are the pieces.** A secret in a system prompt is in
  `servedAt(k).system.text` and in the commit log, verbatim. Treat a recording
  accordingly.
- The **receipt carries no bytes** — hashes, counts and names only — and those
  hashes are **not** redacted either. The run salt is what makes that safe to
  ship: the same sentence in two runs has two fingerprints, so a digest cannot
  be dictionary-matched across recordings. It is not an assumption that
  something scrubbed it.
- **Redaction in this library is EXECUTOR-level**, and reaches an inner run
  through `flowchartAsTool({ redact })` / `runbookAsTool({ redact })`
  (`executor.setRedactionPolicy`). footprintjs scrubs at COMMIT time, so a
  redacted key never enters that inner **commit log**. The live `sharedState`
  view is a different thing — only `getSnapshot({ redact: true })` serves the
  mirror — and since 9.89.1 both tools serve THAT view for everything they
  show (the result, the kept record, the recording; `src/core/servableSnapshot.ts`
  · `servableSnapshot`), so an inner record is scrubbed in every field, not
  only in its log.
- A snapshot taken with `redact: true` **omits `initialState`**, so a fold of it
  reports `basis: 'log-only'` and `servedAt` raises the `no-fold-base` gap
  rather than rebuilding a short view in silence.

### Turning the receipt off

`Agent.create({ recordReceipt: false })`. There is no privacy reason to — the
receipt carries no bytes — but there is a cost reason: one commit-log value per
iteration plus a SHA-256 per system piece, per message and per tool schema. An
offline eval loop scoring ten thousand turns nobody will scrub is entitled to
decline it. `servedAt` still rebuilds every epoch; `receiptAt` returns
`undefined`, exactly as on a pre-9.88 recording.

### A resumed run reads correctly, and says so when it cannot

A resume is a fresh executor seeded from `checkpoint.sharedState`, so the whole
pre-pause world — the system prompt pieces, the conversation, the tool list — is
the resumed run's fold BASE and not its log. Every read here folds from that
base (`keyedFold.ts`, over footprintjs 9.17's `stateAt` and its own
`applySmartMerge`), so `servedAt` on the turn after a resume rebuilds the real
prompt and the whole window. A recording that arrives without its base cannot,
and raises `no-fold-base` instead of reporting an empty one.


## The two chart shapes

### `reactMode: 'dynamic'` — the turn is on the outer log

The flat chart commits `call-llm` in the run's own log, so the llm-turn stop is
on the outer cursor, next to the `sf-injection-engine` iteration stops and the
slot stops.

```ts
const agent = Agent.create({ provider, model: 'm', reactMode: 'dynamic' }).system('bot');
await agent.run('why?');

const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
cursor.stops.filter((s) => milestoneOf(s)?.kind === 'llm-turn').length;   // one per turn
cursor.jumpTo('call-llm#12');
cursor.stateAt().state;              // the state that turn left behind
```

### `reactMode: 'dynamic-grouped'` — the turn is one drill down

The grouped chart wraps each turn in an `sf-llm-call` subflow, which runs in its
own isolated runtime and commits to its own log. So the outer log holds the
MOUNTS — one `'iteration'` stop per turn — and the llm-turn / tool-call /
decision stops live inside. `drill()` is how you get there, and the same
strategy is what reads it.

```ts
const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
const turn2 = cursor.stops.filter((s) => milestoneOf(s)?.kind === 'iteration')[1]!;

const inner = cursor.drill(turn2.runtimeStageId)!;   // its own cursor, its own log
inner.stops.map((s) => milestoneOf(s)?.kind);
// measured: [undefined, 'iteration', 'slot', 'slot', 'slot', 'llm-turn', undefined]
// — the same grammar as the outer axis, over the turn's own 20-commit log.
inner.stateAt().state;                                // folded against the SUBFLOW's base
```

The mount is addressed by its `runtimeStageId`, not its path: a subflow inside a
loop runs many times and every iteration shares one path, so `sf-llm-call#4` and
`sf-llm-call#9` are two different turns and drill to two different logs.

## The tag is the fact, the id is the fallback (9.90.0)

footprintjs 9.21 lets a chart put NAMES on a stage at build time and stamps
them on the stage's first commit bundle (`CommitBundle.tags`). agentfootprint's
charts now declare every milestone the table in `conventions.ts` classifies,
in the vocabulary that file owns — two tags per stage, produced by ONE function
and read back by ONE function, no second string literal anywhere:

| tag | what it is | example |
|---|---|---|
| `milestone:<kind>` | the kind — what a reader FILTERS on | `milestone:llm-turn` |
| `milestone-label:<label>` | the human word the table gives that stage | `milestone-label:LLM turn` |

`milestoneTagsFor(localStageId)` is what a declaration site spreads into
`.tag(...)` or `{ tags }`; `milestoneFromTags(bundle.tags)` reads it back;
`milestoneFor(id)` reads the SAME table from the id. The rule `milestoneStops`
follows, in one sentence: **read the stop's first bundle; if it carries tags,
they are the answer — a bundle tagged as something else is not a stop, however
recognisable its id — and only a bundle with no tags at all is classified from
its id.** That fallback is what a recording made before 9.90.0 gets, and
nothing else: every milestone stage is declared — the three context slots,
selector BRANCH mounts in every Agent chart, carry `milestone:slot` through
`SubflowMountOptions.tags` (footprintjs 9.21.1; it lands on the mount's FIRST
bundle). Both readings come from one table, so they agree wherever both exist;
`test/lib/time-travel/milestone-stops-equivalence.test.ts` pins the tag-only
axis against the id axis on every fixture AND counts the fallback path on the
shipped reader — it must be zero — so a declaration site without its tag goes
red there even where the fallback would have hidden it on the axis.

The Map advertises the vocabulary before any run: `buildTimeStructure` lists
the tags each stage CAN produce, so a lens draws its legend first.

```ts
import { tagStops, timeTravel } from 'footprintjs/trace';
import { milestoneTag, milestoneStopsStrategy } from 'agentfootprint';

// A reader with NO agent id conventions — footprintjs's own strategy, our word:
const turns = timeTravel(agent.getSnapshot()!, { strategy: tagStops([milestoneTag('llm-turn')]) });
turns.stops.map((s) => s.label);   // ['Run start', 'CallLLM', 'CallLLM', 'Run end']
turns.stops[1].meta;               // ['milestone:llm-turn', 'milestone-label:LLM turn']

// The agent's own axis — tag first, id fallback — same stops as 9.88.0, labelled:
const all = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
all.stops[5].meta;                 // { kind: 'llm-turn', label: 'LLM turn' } — read off the bundle
```

A DERIVED mark is the other thing: computed at read time from what the log
says happened, never stored — "the stops where `currentSkillId` was written"
is a keep rule over each stop's own `trace`, the same `filterStops`
composition. `examples/observability/25-declared-vs-derived-stops.ts` scrubs
one real run both ways and measures them (42 commits, mock provider): declared
`tagStops` 0.016 ms, the write-set predicate 0.020 ms, `milestoneStops` 0.018
ms — and the derivation everyone reaches for first, one full `stateAt` per
candidate stop, 11.7 ms (≈ 750×). That cost is why the declaration is the fact
and the derivation is the fallback.

## The honest edge: which keys are visible where

A grouped run's outer log carries what crossed the subflow boundary — what the
`outputMapper` merged back — and the inner log carries what the turn wrote
inside. A key written and read entirely within the turn is on the inner cursor
only. `changedSince()` answers for the log it is asked about and never guesses
about the other one, which is why "scrub the outer axis, drill for the detail"
is the shape of every reader built on this.

## The other honest edge: a resumed run

The cursor reads the snapshot it is handed, and a resume is its own execution
with its own log. So `getSnapshot()` after `agent.resume(checkpoint, answer)`
carries the RESUMED half: its axis begins at the stage the resume re-entered,
and the milestones from before the pause are not on it. They are on the snapshot
taken at the pause — open a second cursor over that one to read the first half.
Nothing about the strategy changes across a pause (the stops still tile, ids
stay unique), which is why this is a note about snapshots rather than a defect.

## What this folder deliberately is not

- **Not a second cursor.** A strategy only says where the one cursor may rest.
  Position, folds, marks and drilling all stay with `timeTravel`.
- **Not a recorder.** Nothing is emitted at run time and nothing is stored
  beside the log. Marks are the reader's notes, held by the cursor, and never
  appear in a recording.
- **Not a re-walk.** A milestone that never committed gets no stop. A cursor
  that stops where no evidence exists is telling a story rather than reading
  one.
