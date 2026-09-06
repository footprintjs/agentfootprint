**Mixed** — the memory presets: declared compositions of read- and write-side
stages, returned as two subflows for the wire layer to mount — and one preset
that also builds the message it mounts.
Map: `default.ts`, `semantic.ts`, `narrative.ts`, `fact.ts`, `ephemeral.ts`,
`types.ts`, `index.ts` — declarations only; nothing in them executes, the stages
they name do.
Walker + Lens: `auto.ts`. `auto.ts` · `autoPipeline` does not only list stages —
it defines an inline `FormatAuto` stage that runs DURING the turn and writes
`scope.formatted`, and `auto.ts` · `renderAutoMessage` is the Lens it calls: it
composes a `{ role: 'system', content }` message out of run-time facts and
beats, renders confidence and refs only when asked, chooses omission (empty
sections are skipped; when BOTH are empty, `formatted = []` and nothing is
injected), and defends its own surface with `auto.ts` · `escapeMemoryTag` so a
stored value cannot close the `</memory>` fence it is rendered inside. That is
the same composer shape `../stages/` · `formatDefault` and `../beats/` ·
`formatAsNarrative` carry.

## What it reads / what it writes
- Reads the preset's options at build time; `auto.ts`'s `FormatAuto` stage reads
  the loaded facts and beats at run time.
- Writes a `MemoryPipeline` value. Only `auto.ts` writes state during a turn
  (`scope.formatted`).

## The one law here
A preset that is only a Map composes declared stages: if a decision has to be
made DURING a turn, it belongs to a stage (`../stages/`), not to the preset that
lists it. `auto.ts` is the stated exception — it carries its formatting stage
inline rather than exporting it, so the exception is one file, named here, and
not a licence for the other presets.

## Files
- `default.ts` — the 90% preset; `auto.ts` — facts + beats on one store, and the
  only file here that runs and composes.
- `semantic.ts`, `narrative.ts`, `fact.ts` — one retrieval flavour each.
- `ephemeral.ts` — read-only.
- `types.ts`, `index.ts`.
