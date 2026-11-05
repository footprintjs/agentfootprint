/**
 * The /features page, as data — twelve verbs, one line each.
 *
 * ONE source of truth for the page's sections and the jump list above them.
 *
 * `line` is approved marketing copy — do not reword. `knownAs` is what people already call this.
 * A name is a claim, so scripts/test/stand-film.test.mts fails if one has nothing real behind it.
 * `href` is a REAL docs route (every one is in lib/doc-ids.mjs `buildRouteSet()` and returns 200
 * on the deployed site).
 */
export type FeatureBeat = {
  /** the section's anchor, and the scene beside it */
  readonly id: string;
  readonly verb: string;
  /** approved copy — byte-identical to the design */
  readonly line: string;
  /** the names people already use for this, each linked to what explains it */
  readonly knownAs: readonly { readonly name: string; readonly href: string }[];
  /** what this does not do, stated beside the claim */
  readonly limit?: string;
  /** Read more → target (a real /docs route) */
  readonly href: string;
  /** accessible name for the Read-more link (the visible text is just "Read more →") */
  readonly hrefLabel: string;
};

export const FEATURE_BEATS = [
  {
    id: 'build',
    verb: 'BUILD',
    line: 'Snap an agent together from pieces.',
    knownAs: [
      { name: 'ReAct loop', href: '/docs/getting-started/key-concepts' },
      { name: 'chains', href: '/docs/build/workflow' },
      { name: 'routers and supervisors', href: '/docs/build/llm-router' },
      { name: 'multi-agent', href: '/docs/build/swarm' },
      { name: 'structured output', href: '/docs/build/output-schema' },
      { name: 'runbookAsTool', href: '/docs/build/runbook-as-tool' },
      { name: 'flowchartAsTool', href: '/docs/build/flowchart-as-tool' },
      { name: 'loop engineering', href: '/engineering#loop' },
    ],
    href: '/docs/getting-started/quick-start',
    hrefLabel: 'Read more about building an agent — Quick Start',
  },
  {
    id: 'teach',
    verb: 'TEACH',
    line: 'Give it skills — it opens only the one it needs.',
    knownAs: [
      { name: 'prompt engineering', href: '/engineering#prompt' },
      { name: 'context engineering', href: '/engineering#context' },
      { name: 'skills', href: '/docs/build/skills' },
      { name: 'SKILL.md files', href: '/docs/build/skills' },
      { name: 'progressive disclosure', href: '/docs/build/skills-explained' },
    ],
    href: '/docs/build/skills',
    hrefLabel: 'Read more about teaching an agent — Skills',
  },
  {
    id: 'know',
    verb: 'KNOW',
    line: 'Tell it what exists, where it lives, and what time it is.',
    knownAs: [
      { name: 'ontology', href: '/how-to-build#know' },
      { name: 'SKOS', href: '/docs/build/agent' },
      { name: 'data references', href: '/docs/build/artifacts' },
      { name: 'claim check', href: '/docs/build/artifacts' },
      { name: 'time awareness', href: '/docs/build/time' },
    ],
    limit: 'An ontology is a map, not a way to fetch. A tool still reads the data.',
    href: '/how-to-build#know',
    hrefLabel: 'Read more about the map, data references and the clock — How to build',
  },
  {
    id: 'remember',
    verb: 'REMEMBER',
    line: 'It keeps what matters between conversations.',
    knownAs: [
      { name: 'long-term memory', href: '/docs/build/memory' },
      { name: 'episodic and semantic memory', href: '/docs/build/fact-extraction' },
      { name: 'RAG', href: '/docs/build/rag' },
    ],
    href: '/docs/build/memory',
    hrefLabel: 'Read more about memory',
  },
  {
    id: 'swap',
    verb: 'SWAP',
    line: 'Same agent. Claude, GPT, or your laptop.',
    knownAs: [
      { name: 'model-agnostic', href: '/docs/build/custom-provider' },
      { name: 'Anthropic', href: '/docs/build/anthropic' },
      { name: 'OpenAI', href: '/docs/build/openai' },
      { name: 'Azure', href: '/docs/infrastructure/microsoft-foundry' },
      { name: 'Bedrock', href: '/docs/build/aws-bedrock' },
      { name: 'Gemini', href: '/docs/build/gemini' },
      { name: 'Ollama', href: '/docs/build/ollama' },
    ],
    href: '/docs/build/openai',
    hrefLabel: 'Read more about providers — OpenAI and OpenAI-compatible endpoints',
  },
  {
    id: 'adapt',
    verb: 'ADAPT',
    line: 'Your cloud, your machines. No adapter yet? Write one.',
    knownAs: [
      { name: 'ports and adapters', href: '/docs/infrastructure' },
      { name: 'hexagonal architecture', href: '/docs/reference/strategy-everywhere' },
      { name: 'plugins', href: '/docs/build/loop-moments' },
      { name: 'bring your own adapter', href: '/how-to-build#write-your-own' },
      { name: 'MCP', href: '/docs/build/mcp-client' },
      { name: 'A2A', href: '/docs/infrastructure/hosting-and-runtime' },
      { name: 'behind your LLM gateway', href: '/docs/build/invoke-model-gateway' },
    ],
    href: '/how-to-build#deploy',
    hrefLabel: 'Read more about infrastructure — How to build, Deploy',
  },
  {
    id: 'show',
    verb: 'SHOW',
    line: 'Stream every step to your own front end.',
    knownAs: [
      { name: 'AG-UI', href: '/docs/infrastructure/ag-ui' },
      { name: 'CopilotKit', href: '/docs/infrastructure/ag-ui' },
      { name: 'frontend tools', href: '/docs/infrastructure/ag-ui' },
      { name: 'streaming', href: '/docs/monitor/streaming' },
    ],
    href: '/how-to-build#front-end',
    hrefLabel: 'Read more about connecting your front end — How to build',
  },
  {
    id: 'watch',
    verb: 'WATCH',
    line: 'See it think, in real time.',
    knownAs: [
      { name: 'observability', href: '/docs/monitor/observability' },
      { name: 'tracing', href: '/docs/monitor/exporters' },
      { name: 'OpenTelemetry', href: '/docs/monitor/exporters' },
      { name: 'custom recorders', href: '/how-to-build#recorders' },
    ],
    href: '/docs/monitor/observability',
    hrefLabel: 'Read more about observability',
  },
  {
    id: 'ask',
    verb: 'ASK',
    line: 'It checks in before doing anything big — with evidence.',
    knownAs: [
      { name: 'human-in-the-loop', href: '/docs/monitor/pausable' },
      { name: 'tool approval', href: '/docs/monitor/checkin' },
    ],
    href: '/docs/monitor/checkin',
    hrefLabel: 'Read more about check-ins',
  },
  {
    id: 'protect',
    verb: 'PROTECT',
    line: 'Name what stays out of the record. Decide who can call what.',
    knownAs: [
      { name: 'PII redaction', href: '/security#privacy' },
      { name: 'role-based access', href: '/security#permissions' },
      { name: 'tenant isolation', href: '/security#tenants' },
      { name: 'audit trail', href: '/security#audit' },
    ],
    limit:
      'Redaction is opt-in, and you add your own check for injected instructions. The Security page shows how.',
    href: '/security',
    hrefLabel: 'Read more about security',
  },
  {
    id: 'why',
    verb: 'WHY',
    line: "When something's wrong, ask why. It answers with receipts.",
    knownAs: [
      { name: 'root-cause analysis', href: '/how-we-debug' },
      { name: 'self-explain', href: '/docs/debug/self-explain' },
      { name: 'replay', href: '/docs/debug/offline-replay' },
      { name: 'time-travel debugging', href: '/docs/debug/time-travel' },
    ],
    href: '/docs/debug/localize-context-bug',
    hrefLabel: 'Read more about localizing a context bug',
  },
  {
    id: 'survive',
    verb: 'SURVIVE',
    line: 'Outages happen. Runs continue.',
    knownAs: [
      { name: 'retry', href: '/docs/monitor/resilience' },
      { name: 'fallback', href: '/docs/monitor/resilience' },
      { name: 'circuit breaker', href: '/docs/monitor/resilience' },
      { name: 'checkpointing', href: '/docs/monitor/reliability' },
    ],
    href: '/docs/monitor/resilience',
    hrefLabel: 'Read more about resilience',
  },
] as const satisfies readonly FeatureBeat[];

export type FeatureId = (typeof FEATURE_BEATS)[number]['id'];

/** The page's one-line promise — the hero's closing statement. */
export const FEATURES_TAGLINE = 'Agents that show their work.';

/** Real, and not one of the twelve. The list at the end of the page. */
export const FEATURES_ALSO = [
  { label: 'Prompt caching', href: '/docs/build/caching' },
  { label: 'Compaction', href: '/docs/build/compaction' },
  { label: 'Streaming', href: '/docs/monitor/streaming' },
  { label: 'Testing with mock()', href: '/docs/debug/testing' },
  { label: 'Tool discovery', href: '/docs/build/tool-discovery' },
  { label: 'Workflows and graphs', href: '/docs/build/graph' },
  { label: 'Artifacts', href: '/docs/build/artifacts' },
  { label: 'Locales', href: '/docs/monitor/locales' },
] as const;
