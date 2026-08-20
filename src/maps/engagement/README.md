# engagement — the lease machine and its renewal feed

**Why.** An earlier design round produced "a parking machine nothing ever tells to park" — a
state machine with no counter. This folder is both halves, deliberately separate:

- `evidence.ts` — **the renewal feed**. Pure functions that join one pass's facts (the previous
  batch's tool calls, the cursor move and its winning clause, the model's accepted picks) to the
  map that owns them, and answer with typed `RenewalEvidence`. The join keys already exist in the
  run; nothing here guesses.
- `lease.ts` — **the law**. `advanceEngagement(plan, prior, pass)` is a pure reducer: founding,
  renewal (with strength upgrades — a guess later confirmed by the system stops decaying), idle
  counting, parking at `renewalGrace`, and evidence-based re-engagement. No I/O, no clock, no
  model.
- `types.ts` — the vocabulary: `EvidenceStrength` (`explicit` > `structural` > `semantic` >
  `lexical` > `assumed`), `MountedMap`, `MapEngagementRecord`, `EngagementPlan`,
  `EngagementChange`.
- `parkCard.ts` — **the model-visible surface**. Everything else here lands on the RECORD, which
  the model never reads. The card is the one thing it does: cursor and engagement as SEPARATE
  fields, the reason, and the way back.

**The record answers THREE questions, not one (9.59.0).** Conflating them is how a guess became a
permanent warrant:

1. *why is this map participating at all?* — `foundedBy` / `foundedAt` / `foundedOn`. Written once,
   never rewritten, never downgraded because time passed.
2. *why is the cursor on THIS member?* — `at` / `atBy` / `atSince`. Observed, never set. A declared
   route firing is not a user request, so a member entered by an edge carries `structural` even
   inside a map whose engagement began `explicit`.
3. *why is THIS contribution served right now?* — `by`. Recomputed every pass. The only one that
   may weaken, and only when the SUBJECT changes (a different member holds the cursor).

**`assumed` is the weakest rung** — *nobody said why*. Reached when the graph cannot explain its
moves (now refused at mount), when the cause was a `'stay'` or `'none'` (which are not moves), or
on a later TURN, where the cursor is carried and the engagement is not. All three used to be
written down as `structural`, the strongest NON-decaying category.

**The idle test has three clauses and all three matter**: the map's contribution was served, none
of its tools was called, and the turn went somewhere else. A pass with no tool calls at all
counts nothing — the model was thinking, not ignoring. The served clause reads the kernel's own
`servedLastPass` carrier, not the slot-delta machinery — that value is permanently empty in the
grouped chart shape, and reading it there disabled parking entirely.

**Measured grounding.** In the recorded stuck turn (entry regex matched the noun "zone"), the
map's four tools were never called and 29 of 30 moves were "stay". Under grace 3 the reducer
parks it on call four, saving ~26 calls from re-serving ~7k characters of the wrong map.

**Runnable example.**

```ts
import { advanceEngagement } from 'agentfootprint/maps';

const plan = {
  maps: [{ id: 'skill-map', memberIds: ['zone-audit'], toolNames: ['get_zone_info'] }],
  renewalGrace: 3,
};

// Pass 1: an entry regex placed the cursor — a lexical guess, engaged.
let { next: state } = advanceEngagement(plan, undefined, {
  iteration: 1, currentNode: 'zone-audit', moveBy: 'entry', witness: 'zone',
  toolResults: [], acceptedSkillPicks: [], servedLastPass: [],
});

// Passes 2–4: the model calls OTHER tools; the cursor stays; idle counts 1, 2, 3 → parked.
for (let i = 2; i <= 4; i++) {
  const adv = advanceEngagement(plan, state, {
    iteration: i, currentNode: 'zone-audit', moveBy: 'stay',
    toolResults: [{ toolName: 'screen_open' }],
    acceptedSkillPicks: [],          // per-PASS picks; a turn-cumulative list renewed forever
    servedLastPass: ['zone-audit'],  // it really did ride last pass — the first idle clause
  });
  state = adv.next; // adv.changes on pass 4: [{ kind: 'parked', idleCalls: 3, witness: 'zone' }]
}
```
