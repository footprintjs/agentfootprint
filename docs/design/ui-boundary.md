# UI boundary & the docs / lens-embed architecture

**Status:** boundary + guardrails landed; the lens *replay seam* is the next build step (spike pending).
**Owner invariant:** the published `agentfootprint` library is **UI-free** and must stay that way.

---

## TL;DR (the decision)

1. **The library is UI-free.** `agentfootprint` ships no React / flowchart / UI dependency. The
   docs app and the lens **consume** agentfootprint — never the reverse. This is enforced at
   build time (see *Enforcement* below), not by convention, so it survives a growing contributor base.
2. **`docs-next/` is its own package** that lives in a subfolder of this repo. Adding a UI dep there
   (e.g. the lens) does **not** touch the published library's `package.json`. Library consumers
   never receive UI packages.
3. **Inline runnable lens examples use "build-time capture → client replay"** (Architecture A): the
   agent runs once in **Node at build time**; the browser only **replays** a captured model. The
   engine never enters a browser bundle; no iframe; no dependency cycle.

There is **no dependency cycle**: `agentfootprint-lens` declares `agentfootprint` as a *peer* (only
hard dep is `dagre`), and `agentfootprint` depends on neither the lens nor the docs. The graph is a
clean fan-out: `agentfootprint → { docs-next, lens }`.

## The architecture (A — build-time capture, client replay)

```
            BUILD TIME (Node, CI)                         BROWSER (static GitHub Pages)
  docs-next  gen:examples
    import agentfootprint (file:.., LOCAL source)        <LensReplay model={json}/>
    import lens.toReplayable()                              import lens/<replay-only entry>
    run the mock example → capture model  ──commit JSON──▶  fromEvents(model) → render flowchart
    write examples/<id>.replay.json                         NO agent · NO network · NO iframe
```

| Piece | Repo | Role | Runs at |
|---|---|---|---|
| `agentfootprint` | `agentfootprint` | engine that runs the example | **build time** (Node) — never shipped to browser |
| `agentfootprint-lens` | `agentfootprint-lens` | **+2 additive things:** `toReplayable()`/`fromEvents()` (headless capture/rehydrate) and a **render-only entry** (no `agentfootprint` peer) | capture at build; render in browser |
| `footprint-explainable-ui` | `explainable-ui` | flowchart UI the lens composes (already a docs dep) | browser |
| `docs-next` | this repo (subfolder) | `gen:examples` generator + `<LensReplay>` MDX component | build + browser |
| `agent-playground` | `agent-playground` | unchanged — the edit-and-rerun sandbox (link "Open live ↗") | — |

**Communication is a pure data handoff:** build-time capture writes a JSON model; the client reads it
and renders. No runtime call between packages, no cross-origin.

**NPM / bundle:** the docs use the lens as a normal npm dependency, but import only the **render-only
entry**, whose peers are `react · react-dom · @xyflow/react · footprint-explainable-ui` — it **drops the
`agentfootprint` peer**, so the engine (agentfootprint + footprintjs) never enters the browser bundle.
The incremental cost over today's static flowchart is tiny (it already bundles `@xyflow/react` +
`footprint-explainable-ui`). **Version alignment** (the lens peers `footprint-explainable-ui ^0.22`, the
docs are on `0.25`) is resolved by **one coordinated lens release** that widens the eui peer and ships
the render-only entry. After that, all three packages release independently — no recurring tax.

## Enforcement (build-time guardrails)

How serious TS libraries keep a layer/UI boundary honest: **ESLint `no-restricted-imports` /
`eslint-plugin-import`** (import-site rules), **`dependency-cruiser`** (config-driven "X may not depend
on Y", renders the graph), and **Nx `@nx/enforce-module-boundaries`** (the monorepo standard). We use
the lightest idiomatic combo for a single repo with ESLint already in CI — **belt and suspenders:**

1. **Import site** — `.eslintrc.js` adds `no-restricted-imports` scoped to `src/**`, banning
   `react`, `react-dom`, `next`, `dagre`, `@xyflow/react`, `footprint-explainable-ui`,
   `agentfootprint-lens` (+ their subpaths and `fumadocs*`). A contributor who imports one gets a red
   error in-editor **and** in `npm run lint` (CI), with a message pointing here.
2. **package.json** — `test/conventions/unit/no-ui-deps.test.ts` asserts the library's
   `dependencies` / `peerDependencies` / `optionalDependencies` declare none of those packages — catches
   a forbidden *declared* dep even before any import. Runs in `npm test` (CI).

*Scale-up:* if/when the documented 8-layer DAG needs full enforcement (not just the UI edge), add
`dependency-cruiser` with rules per layer. If/when the packages merge into a **monorepo**, switch to
Nx/Turborepo module boundaries.

## Alternatives considered (and why not)

- **`<Lens for={agent}/>` bundled into the docs client** — would run the agent in the browser and pull
  the engine into the bundle; agentfootprint client-bundling under Next/Turbopack is unproven. Rejected.
- **iframe a hosted lens app** — works (isolation), but a 2nd-origin embed is clunky and not inline.
  Kept only as the **fallback (Architecture B)** if the replay seam proves infeasible.
- **Separate docs repo (consume published packages)** — clean repo separation but **loses the
  local-source anti-drift** (docs would validate against released, not unreleased, source) and adds
  cross-repo release coordination. Rejected for cosmetic separation.
- **Monorepo (workspaces)** — the *structurally correct* answer **if** library/app co-location becomes a
  real problem; keeps local-source linking and centralizes versions. Deferred — do it deliberately, not
  under this feature, and **not** as a docs-repo split.

## Next build step (spike, in `agentfootprint-lens`)

Prove the load-bearing assumption before wiring the docs: add `LensRecorder.toReplayable()` /
`fromEvents()`, capture one mock scenario in Node, rehydrate, and assert the rendered StepGraph is
deep-equal to a live run. Passes → promote to a `gen:examples` generator + render-only entry + one
coordinated lens release + `<LensReplay>` under each MDX snippet + a `check:examples` diff gate. Fails →
fall back to Architecture B (deep-link the playground).
