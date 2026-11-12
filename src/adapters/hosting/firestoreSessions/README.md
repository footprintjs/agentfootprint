**Support** — the Firestore implementation of the session lifecycle port.

One collection, one document per session. The public index keeps the existing
names; backend, address, retention and error helpers are whole-unit moves.
The pilot charts will keep save/load/list/delete validation, transaction
ownership, size and cursor rules in the recorded path, with no new public API.

The synchronous prefix of save remains one first stage: validate, serialize,
refuse size, derive the row and start the SDK transaction before returning.
Firestore owns transaction retry. Each callback runs the ownership chart anew;
there is no extra retry policy. Inputs, SDK objects and errors stay outside
recorded state; only bounded facts and decision reasons belong in the record.

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

The refused-save example is the real native run in
`bench/results/firestore-refused-save.json`. It records bytes and the ceiling,
not the envelope. The error retains its original class, fields and sentence.
The capability input is deliberately untracked; this is a bounded explanation,
not a complete causal recording of caller data or a public diagnostics API.
