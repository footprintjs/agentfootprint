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
npm test           # vitest (2273 tests)
npm run lint       # eslint
npm run format     # prettier check
npm run test:watch # watch mode
```

## Project Structure

```
src/
├── core/            → LLMCall, Agent, RunnerBase, defineTool, flowchartAsTool, outputSchema, pause
├── core-flow/       → Sequence, Parallel, Conditional, Loop compositions
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
├── thinking/        → provider thinking-block handlers
├── locales/         → message catalogs (commentary + thinking)
├── conventions.ts   → renderer-facing keys (stageRole, milestoneFor, injection keys)
└── *.ts             → subpath barrels (providers, llm-providers, observe, stream, status, …)
```

## Pull Request Checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes (all 2273+ tests)
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
