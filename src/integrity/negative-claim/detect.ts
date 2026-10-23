/**
 * detect — the prose grammar: which units of a reply state a negative claim, by a fixed list of
 * phrases and nothing else (no model, no score).
 *
 * Pattern: units (`units.ts`) → language (`language.ts`) → the `none` and `complete` packs
 *          (`phrases.ts`, matched by `words.ts`). A hedge is not scope and changes nothing here:
 *          "based on the logs, there are no incidents" is a claim. A unit in a fenced block, or a
 *          claim phrase entirely inside inline code, is NOTED (`in-code-block`, with the
 *          phrase's span), not judged; a unit the English grammar cannot read is NOTED
 *          (`language-unsupported`) — never a silent pass.
 * Role:    integrity/ layer (L3), read by `prose.ts`. Pure and deterministic; linear in the text.
 *
 * A claim carries its span, its unit, its phrase id and the pack version. Its unit's tokens ride
 * along for the resolver; rows built from a claim carry none of the text.
 */

import { isSupportedLanguage } from './language.js';
import { NEGATIVE_CLAIM_PHRASES, NEGATIVE_CLAIM_PHRASES_VERSION } from './phrases.js';
import { insideAny, unitsOf, type TextSpan } from './units.js';
import { firstHit, tokensOf, type PhraseHit, type Token } from './words.js';

export type ProseClaimKind = 'none' | 'complete';

/** One detected claim. */
export interface DetectedClaim {
  readonly kind: ProseClaimKind;
  readonly phraseId: string;
  readonly packVersion: string;
  /** The claim phrase's span in the text as given. */
  readonly span: TextSpan;
  /** The unit (clause) the claim is read in. */
  readonly unit: TextSpan;
  /** The unit's tokens — for the resolver; never written to a row. */
  readonly tokens: readonly Token[];
}

/** A unit that could not be judged, said out loud. */
export interface DetectionNote {
  readonly code: 'in-code-block' | 'language-unsupported';
  readonly span: TextSpan;
  readonly phraseId?: string;
  readonly packVersion: string;
}

export interface Detection {
  readonly claims: readonly DetectedClaim[];
  readonly notes: readonly DetectionNote[];
}

const spanOf = (tokens: readonly Token[], hit: PhraseHit): TextSpan => ({
  start: (tokens[hit.first] as Token).start,
  end: (tokens[hit.last] as Token).end,
});

/** Detect the negative claims of a reply. */
export function detectNegativeClaims(text: string): Detection {
  const claims: DetectedClaim[] = [];
  const notes: DetectionNote[] = [];
  const { units, inlineCode } = unitsOf(text);
  const packVersion = NEGATIVE_CLAIM_PHRASES_VERSION;
  for (const unit of units) {
    const tokens = tokensOf(text, unit.start, unit.end);
    if (tokens.length === 0) continue;
    const readable = unit.fenced || isSupportedLanguage(text.slice(unit.start, unit.end), tokens);
    if (!readable) {
      notes.push({
        code: 'language-unsupported',
        span: { start: unit.start, end: unit.end },
        packVersion,
      });
      continue;
    }
    for (const kind of ['none', 'complete'] as const) {
      const hit = firstHit(text, tokens, NEGATIVE_CLAIM_PHRASES[kind]);
      if (hit === undefined) continue;
      const span = spanOf(tokens, hit);
      if (unit.fenced || insideAny(span, inlineCode)) {
        notes.push({ code: 'in-code-block', span, phraseId: hit.phrase.id, packVersion });
        continue;
      }
      claims.push({
        kind,
        phraseId: hit.phrase.id,
        packVersion,
        span,
        unit: { start: unit.start, end: unit.end },
        tokens,
      });
    }
  }
  return { claims, notes };
}
