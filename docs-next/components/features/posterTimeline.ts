/** When things happen in the Features film, in beats. The page imports this up front, and the engine loads later. */
import { FEATURE_BEATS } from '@/lib/features/beats';

const FIRST = 1.15;

/** How long one poster runs, and the flight into the next word at the end of it. */
export const POSTER_LENGTH = 2.6;
export const POSTER_FLY = 0.42;

export const posterStart = (i: number) => FIRST + i * POSTER_LENGTH;

const LAST = FEATURE_BEATS.length - 1;
export const POSTER_END = posterStart(LAST) + POSTER_LENGTH - POSTER_FLY;

/* A caption leaves as the flight begins, so nothing sits on top of the word. */
export const POSTER_CHAPTERS: readonly (readonly [string, number, number])[] = [
  ['hero', 0, posterStart(0) - POSTER_FLY],
  ...FEATURE_BEATS.map(
    (beat, i) => [beat.id, posterStart(i), i === LAST ? 1e9 : posterStart(i + 1) - POSTER_FLY] as const,
  ),
];

export const POSTER_STOPS = FEATURE_BEATS.map((_, i) => ({
  label: String(i + 1),
  at: posterStart(i) + 0.25,
  letter: true,
}));

export const POSTER_STILLS: Readonly<Record<string, number>> = Object.fromEntries(
  FEATURE_BEATS.map((beat, i) => [beat.id, posterStart(i) + POSTER_LENGTH - POSTER_FLY - 0.04]),
);

/* The film quotes these. scripts/test/stand-film.test.mts runs a scripted agent and fails if they drift. */
export const POSTER_QUOTES = {
  exports: ['Agent', 'anthropic', 'openai', 'ollama', 'withFallback'],
  methods: ['resumeOnError'],
  /** One plan, two tools, and the start of the answer, as WATCH logs them. */
  events: [
    'agentfootprint.stream.llm_start',
    'agentfootprint.stream.llm_end',
    'agentfootprint.stream.tool_start',
    'agentfootprint.stream.tool_end',
    'agentfootprint.stream.tool_start',
    'agentfootprint.stream.tool_end',
    'agentfootprint.stream.llm_start',
    'agentfootprint.stream.token',
  ],
} as const;
