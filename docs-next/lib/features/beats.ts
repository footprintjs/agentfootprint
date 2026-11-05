/**
 * The /features storyboard, as data — eight verbs, one line each.
 *
 * ONE source of truth for the film's captions and for the words its posters are built from.
 *
 * `line` is approved marketing copy — do not reword. `inside` names REAL exported surfaces
 * (checked against src/ when written); `href` is a REAL docs route (every one is in
 * lib/doc-ids.mjs `buildRouteSet()` and returns 200 on the deployed site).
 */
export type FeatureBeat = {
  /** the film's chapter id */
  readonly id: string;
  readonly verb: string;
  /** approved copy — byte-identical to the design */
  readonly line: string;
  /** "what's inside" chips: real API/feature names */
  readonly inside: readonly string[];
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
    inside: ['LLMCall', 'Agent', 'Sequence', 'Parallel', 'Conditional', 'Loop', 'Swarm', 'patterns'],
    href: '/docs/getting-started/quick-start',
    hrefLabel: 'Read more about building an agent — Quick Start',
  },
  {
    id: 'teach',
    verb: 'TEACH',
    line: 'Give it skills — it opens only the one it needs.',
    inside: ['skills', 'steering', 'facts', 'injections', 'skill graph', 'triggers'],
    href: '/docs/build/skills',
    hrefLabel: 'Read more about teaching an agent — Skills',
  },
  {
    id: 'remember',
    verb: 'REMEMBER',
    line: 'It keeps what matters between conversations.',
    inside: ['episodic', 'semantic', 'narrative', 'RAG', 'Redis', 'in-memory'],
    href: '/docs/build/memory',
    hrefLabel: 'Read more about memory',
  },
  {
    id: 'swap',
    verb: 'SWAP',
    line: 'Same agent. Claude, GPT, or your laptop.',
    inside: ['anthropic', 'openai', 'azure', 'bedrock', 'ollama', 'browser', 'mock', 'bring-your-own'],
    href: '/docs/build/openai',
    hrefLabel: 'Read more about providers — OpenAI and OpenAI-compatible endpoints',
  },
  {
    id: 'watch',
    verb: 'WATCH',
    line: 'See it think, in real time.',
    inside: ['typed events', 'flowchart', 'timeline', 'cost', 'live status', 'narrative'],
    href: '/docs/monitor/observability',
    hrefLabel: 'Read more about observability',
  },
  {
    id: 'ask',
    verb: 'ASK',
    line: 'It checks in before doing anything big — with evidence.',
    inside: ['checkIn', 'pause/resume', 'permissions', 'audit trail'],
    href: '/docs/monitor/checkin',
    hrefLabel: 'Read more about check-ins',
  },
  {
    id: 'why',
    verb: 'WHY',
    line: "When something's wrong, ask why. It answers with receipts.",
    inside: ['localize', 'ablation proof', 'walk to root', 'influence', 'self-explain'],
    href: '/docs/debug/localize-context-bug',
    hrefLabel: 'Read more about localizing a context bug',
    // flagship beat — the longest, slowest scroll of the page (storyboard note)
  },
  {
    id: 'survive',
    verb: 'SURVIVE',
    line: 'Outages happen. Runs continue.',
    inside: ['retry', 'fallback', 'circuit breaker', 'reliability rules', 'checkpoints'],
    href: '/docs/monitor/resilience',
    hrefLabel: 'Read more about resilience',
  },
] as const satisfies readonly FeatureBeat[];

/** The eight anchor ids, as a union — every stage map must cover exactly these. */

/** The page's one-line promise — the hero's closing statement. */
export const FEATURES_TAGLINE = 'Agents that show their work.';
