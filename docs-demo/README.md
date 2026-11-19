# AgentFootprint documentation demos

This app runs the published cohort pinned in its own lock. The Quick Start
viewer opens a saved graph of the real, deterministic mock weather run.
The docs run the same weather fixture against the library at the current
commit in `check:tryit`.

```sh
npm ci --strict-peer-deps
npx --no-install playwright-core install --only-shell chromium
npm run check
```

`check` builds the viewer, reruns the weather fixture to compare the checked-in
SVGs and provenance, verifies the shared engine and Foottrace packages, and
smoke-tests zoom, grouping, drill, breadcrumb and theme in Chromium.
Set `DOCS_DEMO_CHROMIUM_EXECUTABLE` to use an existing Chromium executable.
To also exercise navigation from the real exported guide with the viewer
mounted and with the no-JavaScript static fallback, set `DOCS_DEMO_EXPORT` to the absolute path of the existing
`docs-next/out` export.

Use `npm run gen:flowchart` to update the tracked SVGs and provenance after a
weather fixture or cohort change. For a reviewed AgentFootprint version bump,
record its release commit in the generator. Graphviz's pinned WASM build draws
both SVGs from the Explainable UI recorder's graph; the viewer reads the same
graph and uses Explainable UI's native `TracedFlow`.

The build emits `dist/` with relative asset URLs for `/demo/quick-start/`.
The site's export already contains the fallback at that route. Deploy can
replace its HTML with the verified viewer and add its assets.
