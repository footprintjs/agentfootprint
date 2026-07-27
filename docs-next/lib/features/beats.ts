/**
 * The /features storyboard, as data — eight verbs, one line each.
 *
 * ONE source of truth shared by the hero (server-rendered in-page nav) and the beats
 * (client-rendered scroll story), so a verb can never appear in the nav without its beat.
 *
 * `line` is approved marketing copy — do not reword. `inside` names REAL exported surfaces
 * (checked against src/ when written); `href` is a REAL docs route (every one is in
 * lib/doc-ids.mjs `buildRouteSet()` and returns 200 on the deployed site).
 *
 * `steps` = how many additive reveal layers the beat's stage has. The scroll engine hands the
 * stage a monotonically increasing step index; every layer that arrives STAYS (the canvas never
 * wipes), so the stage is a legible composition at any frame. `dwell` is the beat's scroll
 * height — the flagship WHY beat gets more so it reads slower.
 */
export type FeatureBeat = {
  /** anchor id — the hero verb links to `#${id}` */
  readonly id: string;
  /** two-digit index, shown in the rail and the hero */
  readonly ix: string;
  readonly verb: string;
  /** approved copy — byte-identical to the design */
  readonly line: string;
  /** "what's inside" chips: real API/feature names */
  readonly inside: readonly string[];
  /** Read more → target (a real /docs route) */
  readonly href: string;
  /** accessible name for the Read-more link (the visible text is just "Read more →") */
  readonly hrefLabel: string;
  readonly steps: number;
  /**
   * Scroll height of the beat — the stage is pinned for its whole duration while the rail scrolls
   * past it.
   *
   * This is the ONLY pacing dial: how fast the layers arrive, and how long the finished stage holds
   * at the end, are both derived from it by `useAdditiveSteps.measureDrive`. Raising a `dwell` makes
   * that beat slower and more deliberate WITHOUT breaking the choreography — which is why the
   * flagship WHY is longer than the rest.
   */
  readonly dwell: string;
};

/**
 * `as const satisfies` (not a `: readonly FeatureBeat[]` annotation) so the eight ids survive as
 * literal types. `FeatureBeatId` below is derived from them, which is what makes a beat without a
 * stage a COMPILE error instead of a blank panel in production.
 */
export const FEATURE_BEATS = [
  {
    id: 'build',
    ix: '01',
    verb: 'BUILD',
    line: 'Snap an agent together from pieces.',
    inside: ['LLMCall', 'Agent', 'Sequence', 'Parallel', 'Conditional', 'Loop', 'Swarm', 'patterns'],
    href: '/docs/getting-started/quick-start',
    hrefLabel: 'Read more about building an agent — Quick Start',
    steps: 7,
    dwell: '160vh',
  },
  {
    id: 'teach',
    ix: '02',
    verb: 'TEACH',
    line: 'Give it skills — it opens only the one it needs.',
    inside: ['skills', 'steering', 'facts', 'injections', 'skill graph', 'triggers'],
    href: '/docs/build/skills',
    hrefLabel: 'Read more about teaching an agent — Skills',
    steps: 4,
    dwell: '160vh',
  },
  {
    id: 'remember',
    ix: '03',
    verb: 'REMEMBER',
    line: 'It keeps what matters between conversations.',
    inside: ['episodic', 'semantic', 'narrative', 'RAG', 'Redis', 'in-memory'],
    href: '/docs/build/memory',
    hrefLabel: 'Read more about memory',
    steps: 6,
    dwell: '160vh',
  },
  {
    id: 'swap',
    ix: '04',
    verb: 'SWAP',
    line: 'Same agent. Claude, GPT, or your laptop.',
    inside: ['anthropic', 'openai', 'azure', 'bedrock', 'ollama', 'browser', 'mock', 'bring-your-own'],
    href: '/docs/build/openai',
    hrefLabel: 'Read more about providers — OpenAI and OpenAI-compatible endpoints',
    steps: 3,
    dwell: '164vh',
  },
  {
    id: 'watch',
    ix: '05',
    verb: 'WATCH',
    line: 'See it think, in real time.',
    inside: ['67 events', 'flowchart', 'timeline', 'cost', 'live status', 'narrative'],
    href: '/docs/monitor/observability',
    hrefLabel: 'Read more about observability',
    steps: 7,
    dwell: '168vh',
  },
  {
    id: 'ask',
    ix: '06',
    verb: 'ASK',
    line: 'It checks in before doing anything big — with evidence.',
    inside: ['checkIn', 'pause/resume', 'permissions', 'audit trail'],
    href: '/docs/monitor/checkin',
    hrefLabel: 'Read more about check-ins',
    steps: 5,
    dwell: '162vh',
  },
  {
    id: 'why',
    ix: '07',
    verb: 'WHY',
    line: "When something's wrong, ask why. It answers with receipts.",
    inside: ['localize', 'ablation proof', 'walk to root', 'influence', 'self-explain'],
    href: '/docs/debug/localize-context-bug',
    hrefLabel: 'Read more about localizing a context bug',
    steps: 8,
    // flagship beat — the longest, slowest scroll of the page (storyboard note)
    dwell: '184vh',
  },
  {
    id: 'survive',
    ix: '08',
    verb: 'SURVIVE',
    line: 'Outages happen. Runs continue.',
    inside: ['retry', 'fallback', 'circuit breaker', 'reliability rules', 'checkpoints'],
    href: '/docs/monitor/resilience',
    hrefLabel: 'Read more about resilience',
    steps: 5,
    dwell: '160vh',
  },
] as const satisfies readonly FeatureBeat[];

/** The eight anchor ids, as a union — every stage map must cover exactly these. */
export type FeatureBeatId = (typeof FEATURE_BEATS)[number]['id'];

/** The page's one-line promise — the hero's closing statement. */
export const FEATURES_TAGLINE = 'Agents that explain themselves.';
