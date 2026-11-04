**Mixed** — complete existing units supporting the canonical boundary recorder.
Trace: event construction, domain event contracts, observer options and internal-ID classification. Fold: lean snapshots, content-free range labels and boundary rollups.

`../BoundaryRecorder.ts` retains the whole class, its factory and the sole ID counter. Its stores, indexes, open-token pairing, subscription/run-ID observer state and callback captures stay in that class.

- `domainEvents.ts` owns the existing domain event vocabulary; `flowEvents.ts` keeps the two existing local flow-event shapes.
- `options.ts` owns the typed subscription source and recorder options.
- `eventBuilders.ts` constructs the same run/subflow records and coordinates. `agentInternal.ts` classifies existing plumbing IDs against the unchanged conventions owner.
- `leanContent.ts` keeps the single content-field list, its mapped types and the existing non-mutating lean projection together. The full snapshot default and embedding policy stay with the class.
- `rangeLabels.ts` projects existing content-free range labels. `rollups.ts` folds the same event stream into a boundary aggregate.

The canonical entry keeps every public reference. These leaves add no runner wiring, observer port, redaction policy or alternate recording path.
