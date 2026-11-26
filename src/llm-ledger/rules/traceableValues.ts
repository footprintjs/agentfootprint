/**
 * llm-ledger/rules/traceableValues — `traceable-values@1`: every value a claim or the draft states
 * is in one of its receipts.
 *
 * Pattern: a table rule (`rules/port.ts`). Facts `visible`, `checkable`, `missing`, `incomplete`.
 * Role:    the value check. Its tokens are the ledger's one token rule (`tokens.ts`): a literal
 *          piece of the text with a digit, so a claim and a receipt are read the same way.
 * Emits:   N/A.
 *
 * Tokens come from the note's text and `values`, or from the draft. A token found in a `supplied`
 * entry is exempt: neither missing nor support (only the host writes `supplied`). Every other token
 * rests on the first OBSERVED receipt that holds it, or else the first reported one; a token no
 * receipt holds is missing. A subject that states a value the token rule cannot read as one token
 * (a number with thousands separators, a piece after an escape) is at most `unreachable`, after its
 * visible tokens are checked: a missing visible token still fails it. With a missing token, an
 * incomplete receipt among the subject's
 * receipts (`isIncomplete`: cut, masked, limited, holding grouped numbers or escaped pieces) makes
 * the check `unreachable`, never `checked-fail`: the value may be in the part it left out. A
 * note's `values` are what it claims, never support.
 */
import { isIncomplete } from '../entries.js';
import { readTokens, tokensOf } from '../tokens.js';
import type { LedgerTableRule } from './port.js';

/** The value law's key. It runs in every session, whatever the session pins (`withValueLaw`). */
export const VALUE_LAW = 'traceable-values@1';

/** `keys` with the value law among them: pinning may add rules, never remove this one. */
export const withValueLaw = (keys: readonly string[]): string[] =>
  keys.includes(VALUE_LAW) ? [...keys] : [...keys, VALUE_LAW];

export const traceableValues: LedgerTableRule = {
  id: 'traceable-values',
  version: 1,
  appliesTo: ['claim', 'ruled-out', 'draft'],
  facts: (input) => {
    const subject = input.subject;
    const stated = new Set(
      subject.kind === 'draft'
        ? tokensOf(subject.text)
        : [subject.note.text, ...(subject.note.values ?? [])].flatMap(tokensOf),
    );
    // Values the token rule cannot read as one token: numbers with thousands separators, pieces after an escape.
    const unreadable = (
      subject.kind === 'draft'
        ? [subject.text]
        : [subject.note.text, ...(subject.note.values ?? [])]
    )
      .map(readTokens)
      .reduce((n, r) => n + (r.groupedNumbers ?? 0) + (r.escapedPieces ?? 0), 0);
    const exempt = new Set(input.supplied.flatMap((s) => s.tokens));
    const holders = (token: string) => input.receipts.filter((r) => r.tokens.includes(token));
    const restsOn: number[] = [];
    const missing: string[] = [];
    let supplied = 0;
    for (const token of stated) {
      if (exempt.has(token)) {
        supplied++;
        continue;
      }
      const found = holders(token);
      const first = found.find((r) => r.how === 'observed') ?? found[0];
      if (first === undefined) missing.push(token);
      else restsOn.push(first.seq);
    }
    const incomplete = input.receipts.filter(isIncomplete).length;
    const counts = { visible: stated.size, missing: missing.length, supplied, incomplete };
    return {
      facts: {
        visible: stated.size,
        checkable: stated.size - supplied,
        missing: missing.length,
        incomplete,
        unreadable,
      },
      restsOn,
      counts,
      missing,
    };
  },
  table: [
    {
      when: { visible: { eq: 0 } },
      then: 'unreachable',
      label: 'states no value this rule can see',
    },
    {
      when: { checkable: { eq: 0 } },
      then: 'unreachable',
      label: 'every value it states was supplied',
    },
    {
      when: { missing: { gt: 0 }, incomplete: { eq: 0 } },
      then: 'checked-fail',
      label: 'a value it states is in none of its receipts',
    },
    {
      when: { missing: { gt: 0 } },
      then: 'unreachable',
      label: 'a value may be in the part a receipt left out',
    },
    {
      when: { unreadable: { gt: 0 } },
      then: 'unreachable',
      label: 'it states a value this rule cannot read',
    },
  ],
  default: { branch: 'checked-pass', label: 'every value it states is in a receipt' },
};
