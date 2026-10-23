/**
 * search/statementText — the rule for declaration text that can reach a
 * statement the library writes (`statement-text-refused`).
 *
 * Pattern: one pure rule, asked by `declaration.ts` at `defineTool` (an
 *          ERROR: `search` is a new API, so no consumer breaks), over the ONE
 *          list of texts that reach a statement (`statementTextsOf`).
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 * A declaration is untrusted text from the tool author, and a statement of a
 * negative claim is built from it — the source, the subject, each fixed
 * qualifier and default as `name: value`, each argument's name, each gap's
 * `what` and `why`. Three layers hold it, and only the last is the boundary:
 *
 *   1. SHAPE — one line of at most {@link MAX_STATEMENT_TEXT} characters, in a
 *      stated character class: letters, combining marks, digits, spaces and
 *      `. , : ; ' ( ) - _ / & % + # @`. No format character (zero-width, a
 *      bidi override), no control, no quote mark, backtick or bracket a
 *      renderer could be broken out of.
 *   2. A HEURISTIC — the instruction phrases ("do not", "always", "tell the
 *      user", …), scanned after NFKC folding with format characters removed,
 *      so a fullwidth or zero-width-split phrase is caught. A denylist is
 *      never complete (confusables pass it); it catches the honest mistake.
 *   3. THE BOUNDARY — the statement renders declaration text as QUOTED DATA
 *      ATTRIBUTED TO THE TOOL, never as library-authored prose:
 *      `source (as the tool names it): "the incident store"`. Whatever the
 *      words say, the person reads them as the tool's, in quotes. The
 *      statement writer (the negative-claim checker's `statement.ts`) owns
 *      that rendering; this rule only bounds what it is handed.
 */

import { plainLineProblem } from '../../../lib/plainLine.js';

/** The longest declaration text a statement carries. */
export const MAX_STATEMENT_TEXT = 120;

/** The stated character class for statement text (shape, layer 1). */
const STATEMENT_CHARACTERS = /^[\p{L}\p{M}\p{N} .,:;'()\-_/&%+#@]*$/u;

/**
 * The instructing phrases — the design's `declaration-instructs` list, plus
 * the plain imperatives a model obeys. Matched case-folded, on whole words,
 * after NFKC folding (layer 2: a heuristic, not the boundary).
 */
export const STATEMENT_INSTRUCTION_PHRASES: readonly string[] = Object.freeze([
  'do not',
  "don't",
  'always',
  'tell the user',
  'carry these',
  'report that',
  'ignore',
  'disregard',
  'you must',
  'you should',
]);

/** One spelling for the scan: NFKC, format characters removed, case-folded, one space. */
function scanSpelling(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ');
}

/** The instructing phrase `text` carries, or `undefined`. */
export function instructionIn(text: string): string | undefined {
  const t = scanSpelling(text);
  return STATEMENT_INSTRUCTION_PHRASES.find((phrase) => {
    let at = t.indexOf(phrase);
    while (at !== -1) {
      const before = at === 0 ? '' : t[at - 1];
      const after = t[at + phrase.length] ?? '';
      if (!/[\p{L}\p{N}']/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
      at = t.indexOf(phrase, at + 1);
    }
    return false;
  });
}

/**
 * Why `text` (declared under `field`) cannot reach a statement, or
 * `undefined` when it can.
 */
export function statementTextProblem(field: string, text: string): string | undefined {
  const notPlain = plainLineProblem(`\`${field}\``, text);
  if (notPlain !== undefined) return notPlain;
  if (text.length > MAX_STATEMENT_TEXT) {
    return (
      `\`${field}\` is ${text.length} characters; the library's statements carry at most ` +
      `${MAX_STATEMENT_TEXT}.`
    );
  }
  if (!STATEMENT_CHARACTERS.test(text)) {
    return (
      `\`${field}\` carries a character outside the statement set — letters, digits, spaces ` +
      "and . , : ; ' ( ) - _ / & % + # @ — so no quote mark, backtick, bracket or symbol a " +
      'renderer could be broken out of.'
    );
  }
  const instruction = instructionIn(text);
  if (instruction !== undefined) {
    return (
      `\`${field}\` instructs ('${instruction}') — it is read into a statement the person ` +
      'reads, so it describes ground and never tells a reader what to do or say.'
    );
  }
  return undefined;
}
