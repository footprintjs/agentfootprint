# invariant-violation — two things that cannot both be true, caught where they are created

**Why.** In a recorded turn, a subsystem was suspended so its instructions stopped being sent while
four tools it owned kept riding every call. One channel said inactive; another simultaneously showed
it available — and nothing in the system was responsible for noticing. That is an ordinary invariant
violation wearing unfamiliar clothes.

**Where it checks, and the honest deviation from the design brief.** The brief placed this at the
WRITE seam — compare the park against standing assertions the moment it commits. In this
architecture that comparison is wrong at the write: at the moment a park lands, the previous
composition (legitimately) still shows the tools, because the park is the RESPONSE to that serving.
The invariant is forward-looking — parked ⇒ not served from now on — and in a system whose facts
flow through per-pass composition rather than a standing store, the moment both facts first coexist
wrongly is the SAME iteration's compose. So the check runs as the brief's own compose-seam
backstop, one comparison per parked map against the final merged wire list, and still names the
guilty write: the park that minted `parkedToolNames` this very iteration. One finding per defect
per run (identity dedup threaded across passes), however many calls would have re-detected it.

**What it caught on day one — a live defect, not just regression insurance.** The park hold-out
filters the registry and skill lists, but PROVIDER schemas merge unfiltered: a `.toolProvider()`
tool sharing a parked member's name stays on the wire (the shadowing seam — provider wins the wire,
skill wins dispatch). The integration test pins exactly that leak firing one typed finding.

**What it will not do.** It never blocks the write. Recorders in this stack cannot veto — hook throws
are swallowed and the error path commits regardless — and blocking a park because tools were still
registered would invert causality: the park is the correct fact, the stale serving is the defect. Dev
posture throws _after_ the finding is appended, in the writer's own caller. It also never picks a
winner between the two channels; it names the pair.

**How it decides.** It builds the two assertions (`availability(map) = suspended` from the write,
`availability(map) = available` entailed by each owned tool still on the wire) and hands them to the
shared `conflictsOf` algebra — so the fences apply for free: history is quotation, unknowns never
compare, different epochs are history. An unknown serving set (`served === undefined`) is
incomparable and returns nothing, never a guess.

**Runnable example.**

```ts
import { invariantViolationsOf } from './check.js';

const findings = invariantViolationsOf(
  { mapId: 'zone-audit', standing: 'parked', iteration: 4, ownedToolNames: ['get_zone_info'] },
  { names: ['get_zone_info', 'screen_open'], provenance: 'tools slot' },
);
// → one 'invariant-violation' at seam 'write', witnesses naming both channels
```

Healthy cases return `[]` — which the caller files as `checked-pass`, never as silence. That
distinction is the whole point of the disposition ledger next door.

## wire.ts — the check the compose seam cannot do

The compose backstop reads the merged frame. The recorded defect lived PAST it: the frame said a
subsystem's tools were removed, and the adapter still serialized four schemas — every pre-wire check
read a clean frame. So adapters that can, state a **wire manifest** read back from the FINAL request
body after every transform (`adapters/llm/wireManifest.ts`; anthropic + browser-anthropic state it,
mock echoes its request), and `wireViolationsOf` compares it in `callLLM` against the exact request
object handed to the adapter — after the cache strategy's transform, so a strategy edit is never
blamed on the adapter. Both directions are defects with distinct messages (a name that crossed
uncomposed; a composed name that never crossed), one finding per direction with every offending
name aboard. A provider that states no manifest leaves the call INCOMPARABLE — silence, never a
guess — and an empty manifest is a stated zero. Same identity-dedup rail as the compose backstop:
one defect, one `integrity.context_error`, however many calls re-detect it.
