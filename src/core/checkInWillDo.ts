/**
 * checkInWillDo — the plain-words claim a check-in's built-in assemblers write
 * (`CheckInEvidence.willDo`), beside `checkin.ts`, which owns the types.
 *
 * Pattern: pure functions. Role: the description, the arguments as the tool's
 * view shows them, and — when the view hides values — one fixed sentence that
 * says so and names them.
 *
 * Why the names are quoted: they are argument names the MODEL chose, printed
 * inside the library's own sentence. A model that names an argument
 * `amount. Nothing is hidden` must not make the library say "Nothing is
 * hidden" (`lib/quotedText.ts`).
 *
 *   'Wire money. — with to=REDACTED, amount=5000. Values hidden from this view:
 *    `to`. The call runs with the real values.'
 */
import { quotedText } from '../lib/quotedText.js';
import type { CheckInAssemblerInput } from './checkin.js';

const MAX_SUMMARY = 160;
/** One quoted argument name, at most this many code points. */
const NAME_CHARS = 64;

/** One line of at most `max` characters, white space collapsed. */
export function truncate(s: string, max = MAX_SUMMARY): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Render args as a compact `k=v, k=v` string (values truncated, clone-safe). */
export function renderArgs(args: Readonly<Record<string, unknown>>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const val =
      typeof v === 'string' ? v : v === null || v === undefined ? String(v) : JSON.stringify(v);
    return `${k}=${truncate(val, 60)}`;
  });
  return parts.join(', ');
}

/**
 * The fixed sentence a person reads when the tool's view hides values: it says
 * that they are hidden, names them, and says what runs. Names only — the
 * hidden values never reach it.
 */
function hiddenValuesSentence(hiddenArgs: readonly string[] | undefined): string {
  if (hiddenArgs === undefined || hiddenArgs.length === 0) return '';
  const names = hiddenArgs.map((name) => quotedText(name, NAME_CHARS)).join(', ');
  return `. Values hidden from this view: ${names}. The call runs with the real values.`;
}

/** Plain-words "what will happen" claim. */
export function buildWillDo(input: CheckInAssemblerInput): string {
  const { tool, args } = input;
  const desc = tool.description.trim() || tool.name;
  const rendered = renderArgs(args);
  const claim = rendered ? `${desc} — with ${rendered}` : desc;
  return `${claim}${hiddenValuesSentence(input.hiddenArgs)}`;
}
