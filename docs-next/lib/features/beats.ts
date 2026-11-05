/**
 * The /features page, as data — ten verbs, one line each.
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
  /** the names people already use for this */
  readonly knownAs: readonly string[];
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
    knownAs: ['ReAct loop', 'chains', 'routers and supervisors', 'multi-agent', 'structured output'],
    href: '/docs/getting-started/quick-start',
    hrefLabel: 'Read more about building an agent — Quick Start',
  },
  {
    id: 'teach',
    verb: 'TEACH',
    line: 'Give it skills — it opens only the one it needs.',
    knownAs: ['skills', 'SKILL.md files', 'progressive disclosure', 'context engineering'],
    href: '/docs/build/skills',
    hrefLabel: 'Read more about teaching an agent — Skills',
  },
  {
    id: 'remember',
    verb: 'REMEMBER',
    line: 'It keeps what matters between conversations.',
    knownAs: ['long-term memory', 'episodic and semantic memory', 'RAG'],
    href: '/docs/build/memory',
    hrefLabel: 'Read more about memory',
  },
  {
    id: 'swap',
    verb: 'SWAP',
    line: 'Same agent. Claude, GPT, or your laptop.',
    knownAs: ['model-agnostic: Anthropic, OpenAI, Azure, Bedrock, Gemini, Ollama'],
    href: '/docs/build/openai',
    hrefLabel: 'Read more about providers — OpenAI and OpenAI-compatible endpoints',
  },
  {
    id: 'adapt',
    verb: 'ADAPT',
    line: 'Your cloud, your machines. No adapter yet? Write one.',
    knownAs: ['ports and adapters', 'bring your own adapter', 'MCP', 'A2A', 'AG-UI', 'behind your LLM gateway'],
    href: '/docs/infrastructure',
    hrefLabel: 'Read more about infrastructure — ports and adapters',
  },
  {
    id: 'watch',
    verb: 'WATCH',
    line: 'See it think, in real time.',
    knownAs: ['observability', 'tracing', 'OpenTelemetry'],
    href: '/docs/monitor/observability',
    hrefLabel: 'Read more about observability',
  },
  {
    id: 'ask',
    verb: 'ASK',
    line: 'It checks in before doing anything big — with evidence.',
    knownAs: ['human-in-the-loop', 'tool approval'],
    href: '/docs/monitor/checkin',
    hrefLabel: 'Read more about check-ins',
  },
  {
    id: 'protect',
    verb: 'PROTECT',
    line: 'Name what stays out of the record. Decide who can call what.',
    knownAs: ['PII redaction', 'role-based access', 'tenant isolation', 'audit trail'],
    limit:
      'Redaction is opt-in. It covers the record, not what the model or your tools receive, and a saved recording still carries the final answer. Prompt-injection detection is not included, so you plug in your own check.',
    href: '/docs/monitor/security',
    hrefLabel: 'Read more about security',
  },
  {
    id: 'why',
    verb: 'WHY',
    line: "When something's wrong, ask why. It answers with receipts.",
    knownAs: ['root-cause analysis', 'replay', 'time-travel debugging'],
    href: '/docs/debug/localize-context-bug',
    hrefLabel: 'Read more about localizing a context bug',
  },
  {
    id: 'survive',
    verb: 'SURVIVE',
    line: 'Outages happen. Runs continue.',
    knownAs: ['retry', 'fallback', 'circuit breaker', 'checkpointing'],
    href: '/docs/monitor/resilience',
    hrefLabel: 'Read more about resilience',
  },
] as const satisfies readonly FeatureBeat[];

export type FeatureId = (typeof FEATURE_BEATS)[number]['id'];

/** The page's one-line promise — the hero's closing statement. */
export const FEATURES_TAGLINE = 'Agents that show their work.';

/** Real, and not one of the ten. The list at the end of the page. */
export const FEATURES_ALSO = [
  { label: 'Prompt caching', href: '/docs/build/caching' },
  { label: 'Compaction', href: '/docs/build/compaction' },
  { label: 'Streaming', href: '/docs/monitor/streaming' },
  { label: 'Testing with mock()', href: '/docs/debug/testing' },
  { label: 'Tool discovery', href: '/docs/build/tool-discovery' },
  { label: 'Flowcharts as tools', href: '/docs/build/flowchart-as-tool' },
  { label: 'Artifacts', href: '/docs/build/artifacts' },
  { label: 'Locales', href: '/docs/monitor/locales' },
] as const;
