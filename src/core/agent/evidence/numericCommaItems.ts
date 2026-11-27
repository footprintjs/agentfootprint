import { normalizeToken } from '../../../lib/normalize.js';

const NUMBER = /^[-+]?\d+(?:\.\d+)?%?$/;
const NUMBER_WITH_UNIT = /^(\d+(?:\.\d+)?)[a-z]+$/i;

interface NumericCommaItem {
  readonly spelling: string;
  readonly offset: number;
}

function groupedNumber(spelling: string): boolean {
  return spelling.includes(',') && !normalizeToken(spelling).includes(',');
}

/** Read numeric fields inside one legacy token while leaving its literal identity intact. */
export function* numericCommaItems(token: string): IterableIterator<NumericCommaItem> {
  if (!token.includes(',')) return;
  const fields = token.split(',');
  let offset = 0;
  for (let index = 0; index < fields.length; ) {
    const first = index;
    const start = offset;
    while (index < fields.length && NUMBER.test(fields[index])) {
      offset += fields[index].length + 1;
      index += 1;
    }
    if (index === first) {
      offset += fields[index].length + 1;
      index += 1;
      continue;
    }
    const run = token.slice(start, offset - 1);
    // A valid thousands group with its unit is an intact spelling. Do not
    // expose its leading digits as a second, unqualified number.
    const unitTail = NUMBER_WITH_UNIT.exec(fields[index] ?? '')?.[1];
    if (unitTail !== undefined && groupedNumber(`${run},${unitTail}`)) continue;
    if (groupedNumber(run)) {
      yield { spelling: run, offset: start };
      continue;
    }
    let fieldOffset = start;
    for (let field = first; field < index; field += 1) {
      const spelling = fields[field];
      yield { spelling, offset: fieldOffset };
      fieldOffset += spelling.length + 1;
    }
  }
}
