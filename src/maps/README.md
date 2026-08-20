# maps — the mount kernel

**Why.** An agent can be fed by more than one walkable map: the skill map (which skill is active)
today, an application's screen map (which page the person is on) next. Each map is sound alone —
a declared graph, a cursor, one writer. What nothing owned was their **composition**: in a
recorded 30-call turn, an entry regex matched the word "zone" inside *"find the most recent zone
redundancy run"* — a noun the person wanted to find, not a task — and the turn stood on an audit
skill for all 30 calls. Its four tools were never called; ~7k characters of the wrong map rode
every call of a 359,000-token turn; 29 of 30 cursor moves were "stay". The map behaved exactly as
specified. The missing layer is the one that asks: *is this map's contribution still earning its
place?*

**The key idea: engagement is orthogonal to the cursor.** The MAP owns its position — "stay on
the node until an edge leaves" remains literally true, always. The KERNEL owns **engagement**:
whether the map's prompt and tools ride the next call. Parking a map never moves its cursor.

**The law** (`engagement/`): an engagement founded on a guess (`lexical` regex, `semantic`
classifier) is renewed only by concrete evidence — the map's own tool called, a declared route
fired, the model asking by name. Without corroboration for `renewalGrace` consecutive passes
(default 3) it is **parked**: skipped by the evaluator with the honest reason `'parked'`, on the
record. Explicit or structural evidence re-engages it on the spot — an accepted `read_skill` pick
is the shipped recovery door, so parking is never a trap. Engagements backed by `explicit` or
`structural` evidence never decay. `nonParkable` maps (policy maps) never park.

**Units in this family:**

| folder | one job |
|---|---|
| `claim/` | `Claim<T>` — a value that says how it knows itself; an unknown can never render as zero |
| `engagement/` | the lease state machine (`lease.ts`) + the renewal feed (`evidence.ts`) + the vocabulary (`types.ts`) |

**Where it hooks in** (all zero-delta when `.maps()` is absent):

- `AgentBuilder.maps(options)` resolves the plan at `build()` (member ids from the mounted graph,
  tool names from its skills) and refuses when no map is mounted.
- The injection engine's Evaluate stage advances engagement each pass with the SAME ctx the
  triggers gate on, and hands parked members to the evaluator as `ctx.parkedIds` — the
  `leaseActiveIds` admission's mirror, so the record and the wire can never disagree.
- State rides `AgentState.mapEngagement` through the same alias round trip the cursor uses
  (`nextMapEngagement` at the boundary).
- Standing changes are typed events: `agentfootprint.map.engaged` / `agentfootprint.map.parked`
  (subscribe with `agent.on('agentfootprint.map.*', …)`). A rule whose engagements always park
  with zero renewals is measurable decoration — that is the declaration telemetry this ships.

**Runnable example.**

```ts
import { Agent } from 'agentfootprint';
import { defineSkillMap } from 'agentfootprint/skill-graph';

const map = defineSkillMap({ skills, start: { rules } }).build();
const agent = Agent.create({ provider, model })
  .skillGraph(map)
  .maps({ renewalGrace: 3 })
  .build();

agent.on('agentfootprint.map.parked', (e) => {
  console.log(`${e.payload.mapId} parked after ${e.payload.idleCalls} idle calls`);
});
```

**Honest limits.** One map mounts today (the agent refuses a second `.skillGraph()`, and that
refusal stays law until the multi-map port earns its overturn); parking is forward-only (a body
already delivered into history stays there); and parking suppresses the OFFER, not
dispatchability — a parked map's tools stay callable by name, which is deliberate (calling one is
renewal evidence). The `renewalGrace` default of 3 was calibrated on a pre-9.55/9.57 recording
corpus; re-baseline before trusting it further.
