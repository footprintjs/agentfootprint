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
npm test           # vitest (3866 tests)
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
- [ ] `npm test` passes (all 3866+ tests)
- [ ] `npm run lint` passes
- [ ] No `any` casts unless unavoidable (document why)
- [ ] New features have tests (5+ patterns)
- [ ] JSDoc on public APIs
- [ ] CHANGELOG.md updated

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
