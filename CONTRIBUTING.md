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
npm test           # vitest (1347 tests)
npm run lint       # eslint
npm run format     # prettier check
npm run test:watch # watch mode
```

## Project Structure

```
src/
├── concepts/     → LLMCall, Agent, RAG, FlowChart, Swarm, Parallel
├── lib/          → Instructions, narrative, loop, call stages
├── adapters/     → LLM adapters (Anthropic, OpenAI, Bedrock, Mock) + memory stores
├── providers/    → Prompt/tool/message strategies
├── recorders/    → AgentRecorders (Token, Cost, OTel, Explain, etc.)
├── streaming/    → AgentStreamEvent, StreamEmitter, SSEFormatter
├── tools/        → ToolRegistry, defineTool, zodToJsonSchema
├── compositions/ → withRetry, withFallback, withCircuitBreaker
└── types/        → All type definitions
```

## Pull Request Checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes (all 1347+ tests)
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
