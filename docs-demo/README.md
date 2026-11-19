# AgentFootprint documentation demos

This app runs the published cohort pinned in its own lock. The Quick Start
viewer opens a saved graph of the real, deterministic mock weather run. The
skill views show the routing graphs from the two skill guides. Dynamic ReAct
records a live run with a scripted model and opens the native Lens viewer.
Its separate subflow view shows the recorded structure of the model-call
loop. Offline replay draws the chart from the Trace linked in the guide.
The How to Build example records a fresh mock greeting in Lens. The docs
run the recording fixtures against the current library in `check:tryit`.

```sh
npm ci --strict-peer-deps
npx --no-install playwright-core install --only-shell chromium
npm run check
```

`check` builds the viewer, regenerates the fixtures to compare the checked-in
SVGs and provenance, verifies the shared engine and Foottrace packages, and
checks the views and their download budgets in Chromium.
Set `DOCS_DEMO_CHROMIUM_EXECUTABLE` to use an existing Chromium executable.
To also exercise navigation from the real exported guide with the viewer
mounted and with the no-JavaScript static fallback, set `DOCS_DEMO_EXPORT` to the absolute path of the existing
`docs-next/out` export.

Use `npm run gen:flowchart` to update the tracked SVGs and provenance after a
weather fixture or cohort change. For a reviewed AgentFootprint version bump,
record its release commit in the generator. Graphviz's pinned WASM build draws
both SVGs from the Explainable UI recorder's graph; the viewer reads the same
graph and uses Explainable UI's native `TracedFlow`. Use
`npm run gen:skill-graphs` for changes to the skill fixtures and
`npm run gen:dynamic-react` for changes to the Dynamic ReAct fixture.
Use `npm run gen:offline-replay` to recapture the redacted Trace and update
its figures and provenance together.

The build emits `dist/` with relative asset URLs for `/demo/quick-start/`.
The guide links use the `view` query parameter to open the matching view and a
fragment to reach its section on the static fallback. Deploy can replace that
fallback's HTML with the verified viewer and add its assets.
