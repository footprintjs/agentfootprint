# Contributing to agentfootprint

Thank you for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/footprintjs/agentfootprint.git
cd agentfootprint
npm install
npm run build
npm test
```

## Development

```bash
npm run build      # CJS + ESM
npm test           # vitest (4090 tests)
npm run lint       # eslint
npm run format     # prettier check
npm run test:watch # watch mode
```

### Docs-truth check

`npm run docs:truth` answers "do the docs describe what the code actually does?"
for every symbol in the real export map and every event in `ALL_EVENT_TYPES`, and
runs in CI.

It is a **ratchet, not a gate**. Hundreds of pre-existing doc gaps are recorded
in `docs/docs-truth/baseline.json` and pass happily; it fails only when the gap
gets bigger, or when the published docs point a reader at something that does not
exist (that class is never baselined). If it fails on your PR, either describe
the new export in prose on a page under `docs-next/content/docs`, or accept the
debt consciously:

```bash
npm run docs:truth:baseline   # re-record + regenerate docs/DOCS_TRUTH_REPORT.md
```

The re-baseline lands as a reviewable diff, so new debt is visible rather than
silent. `npm run docs:truth:exercise` refreshes the reference-run evidence behind
the "exercised" column by running every `examples/` script — no credentials
needed, and it never reads any. The human-readable findings live in
[docs/DOCS_TRUTH_REPORT.md](docs/DOCS_TRUTH_REPORT.md).

## Project Structure

```
src/
├── core/            → LLMCall, Agent, RunnerBase, defineTool, flowchartAsTool, outputSchema, pause
├── core-flow/       → Sequence, Parallel, Conditional, Loop, workflow, graph compositions
├── patterns/        → selfConsistency, reflection, debate, mapReduce, tot, swarm
├── lib/             → injection-engine, mcp, rag, lazyRequire
├── adapters/        → LLM providers (Anthropic, OpenAI, Bedrock, Mock, Browser*) + memory + observability + port types
├── recorders/       → core (Context, Cost, Agent, Composition, Eval, …) + observability (Boundary, Flowchart, LiveState, Logging, Thinking) recorders
├── events/          → typed event vocabulary, payloads, registry, EventDispatcher
├── memory/          → defineMemory, stores, pipelines, beats/facts/causal/embedding strategies
├── strategies/      → grouped-enabler strategy interfaces + default sinks (observability, cost, live-status, lens)
├── cache/           → prompt/response caching
├── bridge/          → event meta + run-context bridge to footprintjs
├── resilience/      → withRetry, withFallback, withCircuitBreaker
├── reliability/     → reliability rules, circuit breaker, validation
├── security/        → PermissionPolicy, permission checking, redaction
├── tool-providers/  → staticTools, gatedTools, skillScopedTools
├── hosting/         → AgentHost + SessionLifecycle ports, nodeHost, memorySessions, standingAgent
├── thinking/        → provider thinking-block handlers
├── locales/         → message catalogs (commentary + thinking)
├── conventions.ts   → renderer-facing keys (stageRole, milestoneFor, injection keys)
└── *.ts             → subpath barrels (providers, llm-providers, observe, stream, status, …)
```

## Pull Request Checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] No `any` casts unless unavoidable (document why)
- [ ] New features have tests (5+ patterns)
- [ ] JSDoc on public APIs (it IS the API reference — generated, never hand-written)
- [ ] A `.changes/*.md` fragment when `src/` changed ([format](.changes/README.md)) — never edit `CHANGELOG.md` or the version by hand
- [ ] `npm run docs:regen` run and its output committed

## Releasing

**Releases are automatic, through a release pull request.**

1. Merging a PR that carries a `.changes/` fragment starts the Release workflow. It computes the
   next version from the fragments, writes the CHANGELOG entry, bumps `package.json`,
   regenerates every generated doc, and opens (or updates) **one** PR, `chore: release vX.Y.Z`,
   from the branch `release/next`. Later fragments update the same PR.
2. That PR runs the full CI. With auto-merge on it merges itself once CI is green; otherwise
   merge it yourself.
3. Its merge runs every gate again on the exact release tree, then tags, creates the GitHub
   release, publishes to npm with provenance and deploys agentfootprint.dev — each step only if
   the one before succeeded. A red gate publishes nothing; fix it with a normal PR and the
   version publishes when that merges (or re-run the failed job).

Start it by hand with **Actions → Release → Run workflow** or
`gh workflow run publish.yml -f bump=minor` (e.g. to force a bigger bump). `npm run release`
(scripts/release.sh) pushes to `main` directly, so it stops working once `main` is protected.

### One-time setup: the release App

A PR opened with the workflow's own `GITHUB_TOKEN` runs no CI, so its required checks would
never report. The release PR is opened by a small GitHub App instead:

1. **Create the App** — GitHub → your org (footprintjs) → Settings → Developer settings →
   GitHub Apps → **New GitHub App**. Any name (e.g. `agentfootprint-release`); Homepage URL:
   the repo URL; **Webhook: uncheck Active**. Repository permissions: **Contents: Read and
   write**, **Pull requests: Read and write** (Metadata: read is added for you). "Where can
   this App be installed": **Only on this account**. Create it.
2. **Keys** — on the App's page, copy the **Client ID**, then **Generate a private key**
   (a `.pem` file downloads).
3. **Install it** — the App's page → Install App → footprintjs → **Only select repositories**
   → `agentfootprint`.
4. **Store them in the repo** — agentfootprint → Settings → Secrets and variables → Actions:
   - Variables tab → **New repository variable** `RELEASE_APP_CLIENT_ID` = the Client ID.
   - Secrets tab → **New repository secret** `RELEASE_APP_PRIVATE_KEY` = the whole `.pem`
     file's contents. Then delete the downloaded file.
5. **Auto-merge** (optional, for hands-off releases) — Settings → General → Pull Requests →
   **Allow auto-merge**.

### Protecting `main`

Settings → Rules → Rulesets → **New branch ruleset**: target the default branch; enable
**Restrict deletions**, **Block force pushes**, **Require a pull request before merging**
(0 required approvals if you are the only maintainer — otherwise every release PR waits for
an approval) and **Require status checks to pass** with: `test (20)`, `test (22)`, `lint`,
`docs`, `generated`, `docs-links`, `docs-truth`, `coverage`, `changes`. Leave the bypass list
empty. Tags are not affected, so the Release workflow can still tag and publish.

## Commit Messages

Follow conventional commits:
- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `refactor:` code refactor (no behavior change)
- `test:` tests only
- `chore:` build, CI, deps

## Reporting Issues

Use the issue templates on GitHub. Include:
- Version (`npm ls agentfootprint`)
- Provider (Anthropic/OpenAI/Bedrock/Ollama)
- Minimal reproduction code

## License

By contributing, you agree that your contributions will be licensed under MIT.
