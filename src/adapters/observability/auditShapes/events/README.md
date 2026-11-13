**Lens** — whole-event audit shapes, grouped without changing evaluation or insertion order.

`content`, `decisions`, `lifecycle`, `streaming`, `resources`, `routing` and `outcomes`
are consecutive sections of the original table. Each creates fresh event rules
using the shared pieces and exhaustive `eventShape` constructor. Only content
receives the live tool-run lookup. Groups do not import one another.

`boundaries.test.ts` exercises the composed facade across every group. The facade's
adjacent surface test pins the full ordered key list; the existing exhaustive
payload-depth and audit-fates snapshot stays the authority for every field.
