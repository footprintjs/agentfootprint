import { tokenize } from '../../../lib/normalize.js';
import { numericCommaItems } from './numericCommaItems.js';
import { scientificDecimalOf } from './numberPrecision.js';
import type { ResolvedEvidenceGate } from './types.js';

/**
 * Read the old token forms first. A declared identifier contributes its
 * literal form alone. A numeric field or exact scientific decimal gets the
 * same result, turn and budget as the spelling it came from.
 */
export function* evidenceTextValues(
  text: string,
  gate: Pick<ResolvedEvidenceGate, 'decimalRounding' | 'shapes'> | undefined,
  readNumbers: boolean,
): IterableIterator<string> {
  for (const token of tokenize(text)) {
    yield token;
    const readCommaValues = readNumbers && token.includes(',');
    if (
      (!readCommaValues && gate?.decimalRounding !== true) ||
      gate?.shapes.some((shape) => shape.match.test(token)) === true
    )
      continue;
    if (readCommaValues) for (const item of numericCommaItems(token)) yield item.spelling;
    if (gate?.decimalRounding === true) {
      const decimal = scientificDecimalOf(token);
      if (decimal !== undefined) yield decimal.exact;
    }
  }
}
