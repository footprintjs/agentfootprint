**Mixed** — the native tool-call handler and its operation families.
Walker: batch execution, individual calls, resume continuations and resource admission.
Lens: fixed refusal and settlement sentences.
Fold: typed facts, argument views and evidence/result projections.

# Tool-call stage modules

The canonical entry is index.ts. It composes the callback families once, then installs the native execute and resume handlers. The public handler and helper exports keep their existing owner.

- compose.ts owns construction order and the existing warning/counter lifetimes.
- batch/ owns batch admission, frozen callback views, the serial call loop and normal completion.
- access/ owns permission, consent, argument admission and invocation-local initializers.
- execution/ owns catalog/resource adapters, artifact and credential admission, invocation and result landing.
- resume/ keeps the four distinct resume continuations and their cleanup order.
- observation/, routing/, evidence/, decorators/ and helpers/ keep their named existing jobs.
- contracts/ contains type-only ports, phase cells and ephemeral batch/call references.

Individual calls return local landed, halted or paused facts. The native batch handler forwards the original pause payload, stops siblings on halt and otherwise continues its existing loop. These facts do not become checkpoint state or a second run engine. Runtime functions, views and credentials remain local references; the existing resource adapter alone carries finite owner data through checkpoints.

Configuration reads stay late. Already initialized constant callbacks pass directly; forward construction links keep accessors. Optional-family imports remain behind their owning guards. Structural boundaries require fresh compiler, cancellation, recording and behavior checks before source clearance.
