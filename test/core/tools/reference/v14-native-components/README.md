# Native-component record fixtures (14)

These named expectations retain the complete observed commit order and served projection with the existing normalizer. Historical JSON remains in the parent folder; three unchanged scenarios continue comparing directly to it.

The saved two-run comparison found explicit identity/transport/resource-owner writes and matching set traces, plus repeated System Prompt/Messages completion-order changes in the existing parallel slots. Served projections and commit counts stayed unchanged. This records the observed schedule after native component control changed; it does not assert a new scheduling design or universal schedule determinism.

No observed log is sorted, filtered or rewritten. Full equality still checks payloads, receipts, phases, trace verbs, positions and order. Raw identity/ownership and privacy controls remain separate because the historical normalizer masks volatile IDs. MANIFEST.json binds both historical and current expected bytes. A changed fixture needs its own explicit delta and exact source review; diagnostic self-comparison is not approval.

AF285 correction: the two argument-ask captures now include the ordered batch's declared parties and the bounded current/last-served pause carrier. Resume clears that carrier once, producing its named trace. Completed answers clear argument-ask working state before dispatch; the hidden-answer privacy controls pass before refresh. The manifest test compares every historical/current served view and admits only these state fields/traces and the existing parallel context-slot schedule delta. Update mode now requires an explicit case allowlist and prints old/new hashes; it cannot silently rewrite all captures.
