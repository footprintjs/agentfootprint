/** The host delivery chart's comparison and atomic stamp. */
import { decide } from 'footprintjs';
import type { TypedScope } from 'footprintjs';

import { assessDelivery } from './omissions/assessment.js';
import type { LedgerReader } from './reader.js';
import type { CallFrame, CallState } from './stages.js';
import type { LedgerEntry } from './types.js';

type Scope = TypedScope<CallState>;

/** `compare` (deliver): does the delivered text match the last submit's draft? */
export function compare(frame: CallFrame) {
  return (s: Scope) => {
    const last = frame.reader?.lastSubmit;
    const delivered = frame.built as LedgerEntry & { kind: 'delivered' };
    s.hasSubmit = last !== undefined;
    s.matches = last !== undefined && last.draftDigest === delivered.digest;
    return decide(
      s,
      [
        { when: { hasSubmit: { eq: false } }, then: 'no-submit', label: 'nothing was submitted' },
        { when: { matches: { eq: true } }, then: 'matches', label: 'the checked draft' },
      ],
      { branch: 'differs', label: 'not the checked draft' },
    );
  };
}

/** The `deliver` entry, stamped with the comparison `compare` made. */
export function stampDelivered(frame: CallFrame) {
  return (s: Scope) => {
    const delivered = frame.built as LedgerEntry & { kind: 'delivered' };
    const last = frame.reader?.lastSubmit;
    const at = frame.clock();
    const compared = { ...delivered, matches: s.matches === true };
    const coverageOmissions = assessDelivery(
      frame.reader as LedgerReader,
      compared,
      frame.deliveryCoverage,
    );
    frame.batchAt = (first) => [
      {
        ...compared,
        ...(coverageOmissions === undefined ? {} : { coverageOmissions }),
        seq: first,
        at,
        submit: last === undefined ? null : last.seq,
      } as LedgerEntry,
    ];
  };
}
