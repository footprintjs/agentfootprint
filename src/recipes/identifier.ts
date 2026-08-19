/**
 * identifier — the plain-name rule for a recipe id.
 *
 * Pattern: a total predicate + a refusal sentence. Pure, no dependencies.
 * Role:    recipes/ layer. Used by `defineAgentRecipe` and by the same
 *          validation `AgentBuilder.recipe()` runs on a hand-written literal.
 * Emits:   N/A.
 *
 * ## Two rules, and the second one is the interesting one
 *
 * 1. **A plain name.** Lower-case words joined by single hyphens:
 *    `support-desk`, `triage`, `refund-policy`. The id is what a person reads
 *    on a run manifest, in a conflict refusal and in a bug report, so it is
 *    spelled the way the rest of this library's public names are — for the
 *    common reader, not for the implementation.
 *
 * 2. **No version suffix.** `support-desk-2` and `support-desk-v2` are refused.
 *    A recipe already HAS a version field; an id that also encodes one produces
 *    two names for one composition, and then nothing groups: runs of `-2` and
 *    runs of the original look like two unrelated agents on the record, while
 *    the field that exists to tell them apart says `1.0.0` on both.
 *
 * ## The honest limit of rule 2
 *
 * It matches the version-suffix SHAPES — a final hyphen-separated segment that
 * is nothing but digits, optionally preceded by `v`. It does NOT catch an id
 * that merely ends in a digit, because `oauth2`, `s3-archive` and `sha256` are
 * real words and refusing them would be worse than missing `triage2`. Stated
 * rather than implied: this check narrows a mistake, it does not eliminate it.
 */

/** Lower-kebab: starts with a letter, single hyphens, no trailing hyphen. */
const PLAIN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A final segment that is a version: `2`, `07`, `v2`. */
const VERSION_SUFFIX = /(?:^|-)v?\d+$/;

/** Long enough for a sentence-like name, short enough to read in a refusal. */
const MAX_LENGTH = 64;

/** Whether `value` is a plain recipe id. Total: any input, no throw. */
export function isPlainRecipeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_LENGTH &&
    PLAIN_NAME.test(value) &&
    !VERSION_SUFFIX.test(value)
  );
}

/**
 * The sentence a bad id gets. Names the value and the specific rule it broke —
 * the version-suffix case in particular, because the fix there is not
 * "spell it differently" but "use the field that already exists".
 *
 * @param callSite - the API the author called, e.g. `defineAgentRecipe`.
 */
export function recipeIdRefusal(callSite: string, value: unknown): string {
  const shown = typeof value === 'string' ? `'${value}'` : `${typeof value}`;
  if (typeof value === 'string' && PLAIN_NAME.test(value) && VERSION_SUFFIX.test(value)) {
    const base = value.replace(VERSION_SUFFIX, '');
    return (
      `${callSite}: id ${shown} ends in a version suffix. A recipe carries its version in the ` +
      `\`version\` field, so an id that encodes one too gives a single composition two names — ` +
      `and then nothing groups: runs of ${shown} and runs of '${base}' read as two unrelated ` +
      `agents on the manifest, while the field that exists to tell them apart says the same ` +
      `thing on both.\n\n` +
      `Use id: '${base || 'a-plain-name'}' and bump \`version\` instead.`
    );
  }
  return (
    `${callSite}: id ${shown} is not a plain name. A recipe id is lower-case words joined by ` +
    `single hyphens, starting with a letter, at most ${MAX_LENGTH} characters — ` +
    `'support-desk', 'triage', 'refund-policy'.\n\n` +
    `${diagnose(value)}\n\n` +
    `It is spelled for the person who reads it on a run manifest, in a conflict refusal and in ` +
    `a bug report — not for the code.`
  );
}

/** The specific rule broken, when the shape names one. */
function diagnose(value: unknown): string {
  if (typeof value !== 'string') {
    return `An id is a string; this was ${value === null ? 'null' : typeof value}.`;
  }
  if (value === '') return 'This one is empty.';
  if (value.length > MAX_LENGTH) return `This one is ${value.length} characters.`;
  if (value !== value.trim()) return 'This one has leading or trailing whitespace.';
  if (/[A-Z]/.test(value)) {
    return `Lower-case only — write '${value
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()}'.`;
  }
  if (/\s/.test(value))
    return `Join the words with hyphens — '${value.trim().replace(/\s+/g, '-')}'.`;
  if (/^[^a-z]/.test(value)) return 'It has to start with a letter.';
  if (/-$/.test(value)) return 'It cannot end with a hyphen.';
  if (/--/.test(value)) return 'Single hyphens only.';
  return 'Allowed characters are a–z, 0–9 and single hyphens between them.';
}
