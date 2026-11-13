**Support** — the Firestore implementation of the session lifecycle port.

One collection, one document per session. The public index keeps the existing
names; backend, address, retention and error helpers are whole-unit moves.
The pilot charts run save/load/list/delete validation, transaction ownership,
size and cursor rules, with no new public API. The public factory does not
attach an observer or retain a debug record. A private test observer can capture
a snapshot; its limits are described below.

The synchronous prefix of save remains one first stage: validate, serialize,
refuse size, derive the row and start the SDK transaction before returning.
Firestore owns transaction retry. Each callback runs the ownership chart anew;
there is no extra retry policy. Inputs, SDK objects and errors stay outside
recorded state. The private snapshot contains bounded facts and reason codes;
decision labels do not reach it, and the branch rationale only names the branch.

The existing SDK-double and session conformance assertions remain the behavior
contract. Explicit private `.js` imports need `/index.js` after a folder move;
the package hosting door and its exports remain unchanged. No forwarding shim.

## Example

```ts
import { firestoreSessions } from 'agentfootprint/hosting';
const sessions = firestoreSessions({ collection: 'conversations' });
await sessions.persist(sessionId, envelope);
const restored = await sessions.hydrate(sessionId);
await sessions.close();
```

## Executable drawings

These drawings come from the built charts' `toMermaid()` and are pinned by
`src/adapters/hosting/firestoreSessions/chart.test.ts`. Transaction retries are owned by
Firestore: every callback gets its own ownership run, rather than a second
retry loop. The original validation/snapshot/request-start prefix remains a
single first stage to preserve synchronous side effects.

<!-- charts:start -->
### saveChart

```mermaid
flowchart TD
save["Validate, snapshot and start save"]
save --> save_outcome
save_outcome["Save outcome"]
save_outcome --> refuse
refuse["Preserve refusal"]
save_outcome --> complete
complete["Saved"]
```

### hydrateChart

```mermaid
flowchart TD
hydrate["Read session row"]
hydrate --> stored_row
stored_row["Stored row"]
stored_row --> refuse
refuse["Preserve read refusal"]
stored_row --> absent
absent["No stored session"]
stored_row --> decode
decode["Decode and validate envelope"]
```

### listChart

```mermaid
flowchart TD
list["Parse cursor and query page"]
list --> query_outcome
query_outcome["Query outcome"]
query_outcome --> refuse
refuse["Preserve query refusal"]
query_outcome --> complete
complete["Project page and cursor"]
```

### ownerChart

```mermaid
flowchart TD
owner["Read ownership row"]
owner --> owner_outcome
owner_outcome["Read outcome"]
owner_outcome --> refuse
refuse["Preserve read refusal"]
owner_outcome --> complete
complete["Read established owner"]
```

### forgetChart

```mermaid
flowchart TD
forget["Delete session document"]
forget --> forget_outcome
forget_outcome["Delete outcome"]
forget_outcome --> refuse
refuse["Preserve delete refusal"]
forget_outcome --> complete
complete["Forgotten"]
```

### ownershipChart

```mermaid
flowchart TD
ownership["Read and resolve transaction owner"]
ownership --> owner_may_write
owner_may_write["Owner may write"]
owner_may_write --> refuse
refuse["Different signer or read failed"]
owner_may_write --> write
write["Replace row with established owner"]
```

### closeChart

```mermaid
flowchart TD
close["Close owned client"]
close --> close_outcome
close_outcome["Close outcome"]
close_outcome --> refuse
refuse["Preserve close refusal"]
close_outcome --> complete
complete["Closed"]
```
<!-- charts:end -->

The refused-save artifact in `bench/results/firestore-refused-save.json` is a
private test demonstration, not a debug record retained by the public store.
`chart.test.ts` attaches an observer to the private `buildStore` factory to
capture an actual native snapshot. The public `firestoreSessions` factory
supplies no observer, so it neither retains nor exposes that snapshot.

The snapshot contains bytes, the ceiling and the `envelope-too-large` reason
code, not the envelope. The size-rule label is absent; the recorded decision
rationale is only `returned branchId: refuse`. The artifact's `sentence` is
constructed by the test from the thrown error and the observed absence of a
transaction call; it is not generated from the run record. The error retains
its original class, fields and sentence. The capability input is deliberately
untracked, so this is not a complete causal recording of caller data.

Pilot requirement 4 (a saved run record that explains the refused save) remains
unmet for the public store. The chart pattern and record design remain on hold
for the owner's decision; this demonstration does not establish a production
debug log or authorize a new recording API.
