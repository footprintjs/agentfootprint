# English time reader

This sealed library tokenizes the closed English grammar into parts and verbatim
quotes. It never resolves instants, maps zones, chooses policy or calls a model.
The only external dependency is the TimeReader port (`time/reader.ts`).

| Unit | One job | Dependencies |
|---|---|---|
| `../english.ts` | Public reader identity/options; group phrases into mentions and compose parts | port, Atom, grammar, atoms |
| `grammar.ts` | Existing closed word/regex grammar and its match iterator | none |
| `atoms.ts` | Existing primitive recognizers and overlap/zone attachment order | port types, Atom, grammar, zones |
| `zones.ts` | Existing zone token grammar and attachment, including elapsed spans | Atom |
| `types.ts` | Existing Atom shape | port types |

The grammar, iterator and atom-recognition units moved whole from the facade.
Public reader/options/identity exports and the exported modifier regex objects
retain their existing names and behavior. The 1.3 reader behavior identity is
unchanged by this split. Group/parts logic remains in the facade; it is below the
600-line limit. There is no parser or flowchart replacement in this structural
step, and no resolver/correction behavior change.

`reader.test.ts` owns the duration-zone quotation tests beside the reader.
The concrete import fence and existing unit/property/security/performance cases
remain in `test/time/english-reader.test.ts`; the same existing reader is tested
through agents in `test/time/english-run.test.ts`. Duration-zone behavior also
lives at `src/time/resolve/lookback.test.ts`. No test result is claimed here;
Root executes the new-head checks and exact-head review.
