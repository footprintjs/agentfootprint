/** Why a strict planted-answer check failed, as closed labels. No reply text is retained (L-63).
 *
 * The headline stays `arms.mjs · plantedFidelity`: the whole reply must JSON.parse and its
 * `answer` must be exactly "<key> <status>". These labels only explain a `false`. They use three
 * independent axes, so a format miss never hides a wrong answer:
 *   form   — the reply's shape: bare JSON, one fenced block, an object with other bytes around it, no
 *            JSON object, or no answer at all (the run stopped).
 *   answer — the extracted `answer`: exact, the live status in other words, the static table's
 *            status, a superseded reading's status, something else, or missing.
 *   reads  — the served lookups compared with the scenario's count.
 * A diagnosis, not a grade: `reworded` means the reply names only the live status, not that it
 * is correct prose.
 *
 * Retention: the reply is read in memory here. Only string constants from the three sets below
 * are returned, so no reply text, key name or value can reach the report or the journal.
 */
export const ANSWER_FORMS = Object.freeze([
  'bare-json',
  'fenced-json',
  'embedded-json',
  'no-json-object',
  'no-answer',
]);
export const ANSWER_VALUES = Object.freeze([
  'exact',
  'reworded',
  'table-status',
  'superseded-status',
  'other',
  'missing',
]);
export const READ_COUNTS = Object.freeze(['expected', 'fewer', 'more']);

/** Object starts tried per reply. Bounds the work on a hostile reply to 64 linear scans; a reply
 * with 64 broken `{` before its JSON reads as `no-json-object`. */
const MAX_STARTS = 64;
const FENCE_OPEN = /^[ \t\n\r]*```[A-Za-z0-9_-]*[ \t]*\r?\n[ \t\n\r]*$/;
const FENCE_CLOSE = /^[ \t\n\r]*```[ \t\n\r]*$/;

function parseRecord(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The index after the `}` that closes the `{` at `start`, or -1. Strings are skipped. */
function closingBrace(text, start) {
  let depth = 0,
    inString = false,
    escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** The first JSON object in the text that has an `answer` member, else the first object. */
function locateObject(text) {
  let from = 0,
    first;
  for (let tries = 0; tries < MAX_STARTS; tries++) {
    const start = text.indexOf('{', from);
    if (start < 0) break;
    const end = closingBrace(text, start);
    const value = end < 0 ? undefined : parseRecord(text.slice(start, end));
    if (!value) {
      from = start + 1;
      continue;
    }
    const hit = { value, before: text.slice(0, start), after: text.slice(end) };
    if (Object.hasOwn(value, 'answer')) return hit;
    first ??= hit;
    from = end;
  }
  return first;
}

function readReply(reply) {
  if (typeof reply !== 'string') return { form: 'no-answer' };
  const whole = parseRecord(reply);
  if (whole) return { form: 'bare-json', value: whole };
  const hit = locateObject(reply);
  if (!hit) return { form: 'no-json-object' };
  const fenced = FENCE_OPEN.test(hit.before) && FENCE_CLOSE.test(hit.after);
  return { form: fenced ? 'fenced-json' : 'embedded-json', value: hit.value };
}

function answerValue(value, scenario) {
  if (!value || !Object.hasOwn(value, 'answer')) return 'missing';
  const { answer } = value;
  if (answer === `${scenario.key} ${scenario.expected}`) return 'exact';
  if (typeof answer !== 'string') return 'other';
  const superseded = scenario.readings.slice(0, -1);
  const known = new Set([scenario.expected, scenario.tableStatus, ...superseded]);
  const named = new Set(
    answer
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => known.has(word)),
  );
  if (named.size !== 1) return 'other';
  const [status] = named;
  if (status === scenario.expected) return 'reworded';
  if (status === scenario.tableStatus) return 'table-status';
  return 'superseded-status';
}

function readCount(reads, scenario) {
  if (reads === scenario.reads) return 'expected';
  return reads < scenario.reads ? 'fewer' : 'more';
}

/** `reply` is the run's answer text (or undefined); `reads` is the count of served lookups. */
export function answerCheck(reply, scenario, reads) {
  const { form, value } = readReply(reply);
  return { form, answer: answerValue(value, scenario), reads: readCount(reads, scenario) };
}
