/** Bounded observation of original model strings, before library-written statements.
 * The grammar only files findings. It never establishes a claim or blocks delivery. */
import { copyJson } from '../../../lib/boundedJson.js';
import { detectNegativeClaims } from '../../../integrity/negative-claim/detect.js';
import { judgeProseNegatives } from '../../../integrity/negative-claim/prose.js';
import { createProseWorkBudget } from '../../../integrity/negative-claim/work.js';
import { MAX_NEGATIVE_CLAIMS } from '../../../integrity/negative-claim/limits.js';
import { NEGATIVE_CLAIM_PHRASES_VERSION } from '../../../integrity/negative-claim/phrases.js';
import type { ResolvedNegativeClaimPhrases } from '../../../integrity/negative-claim/phrases.js';
import type { ProseRow, TurnRecord } from '../../../integrity/negative-claim/types.js';

// Whole-answer budgets, not per-field multipliers. Length is UTF-16 code units.
const MAX_PROSE_CHARS = 64 * 1024;
const MAX_PROSE_FIELDS = 256;

/** Scan every original free-form string, including nested strings and citation labels.
 * Preflight all limits before looking at any evidence. If any limit is exceeded,
 * one whole-answer note replaces partial findings: skipped work is not success.
 * The caller has already admitted a bounded JSON candidate; copy again so a
 * parser-owned object can never supply getters or mutable evidence to this reader.
 */
export function observeNegativeProse(
  candidate: unknown,
  record: TurnRecord,
  citationField?: string,
  phrases?: ResolvedNegativeClaimPhrases,
): ProseRow[] {
  let chars = 0;
  const note = (code: 'input-limit' | 'too-many-claims' | 'no-read'): ProseRow[] => [
    {
      kind: 'negative-claim-note',
      field: '/',
      code,
      span: { start: 0, end: chars },
      packVersion: phrases?.version ?? NEGATIVE_CLAIM_PHRASES_VERSION,
    },
  ];
  let data: unknown;
  try {
    if (typeof candidate === 'string' && candidate.length > MAX_PROSE_CHARS) {
      chars = candidate.length;
      return note('input-limit');
    }
    data = copyJson(candidate, 1024 * 1024, true);
  } catch {
    return note('input-limit');
  }
  const fields: { field: string; text: string }[] = [];
  const pending = [{ value: data, path: '' }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const { value, path } = entry;
    if (typeof value === 'string') {
      // These closed protocol values are typed citations, not model prose.
      // Their free-form about label still passes through the observer.
      const parts = path.split('/');
      if (
        citationField !== undefined &&
        parts[1] === citationField &&
        /^\d+$/.test(parts[2] ?? '') &&
        ((parts.length === 4 &&
          parts[3] === 'kind' &&
          ['none', 'not-found', 'complete'].includes(value)) ||
          (parts.length === 5 &&
            parts[3] === 'restsOn' &&
            /^\d+$/.test(parts[4]) &&
            /^r[1-9][0-9]{0,3}$/.test(value)))
      )
        continue;
      if (path.length > 4096) return note('input-limit');
      chars += value.length;
      if (chars > MAX_PROSE_CHARS || fields.length === MAX_PROSE_FIELDS) return note('input-limit');
      fields.push({ field: path || '/', text: value });
    } else if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, child] = entries[i];
        const segment = key.replace(/~/g, '~0').replace(/\//g, '~1');
        pending.push({ value: child, path: `${path}/${segment}` });
      }
    }
  }
  let claims = 0;
  for (const { text } of fields) {
    const detection = detectNegativeClaims(text, phrases);
    // Unread units must share the budget: thousands of fenced/code snippets
    // must not amplify one long field path into an unbounded findings ledger.
    claims += detection.claims.length + detection.notes.length;
    if (claims > MAX_NEGATIVE_CLAIMS) return note('too-many-claims');
  }
  const work = createProseWorkBudget();
  const rows: ProseRow[] = [];
  let notedNoRead = false;
  for (const { field, text } of fields) {
    const found = judgeProseNegatives({ field, text, record, phrases, work });
    if (found.some((row) => row.kind === 'negative-claim-note' && row.code === 'input-limit')) {
      return note('input-limit');
    }
    for (const row of found) {
      if (row.kind === 'negative-claim-note' && row.code === 'no-read') {
        if (notedNoRead) continue;
        notedNoRead = true;
        rows.push(...note('no-read'));
      } else rows.push(row);
    }
    // The extra answer-level note shares the observation cap. No partial
    // findings survive any limit, including a stale claim plus this note.
    if (rows.length > MAX_NEGATIVE_CLAIMS) return note('too-many-claims');
  }
  return rows;
}
