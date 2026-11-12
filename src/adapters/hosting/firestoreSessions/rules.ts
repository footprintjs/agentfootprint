import type { DecideRule } from 'footprintjs';
import { FIRESTORE_MAX_ENVELOPE_BYTES } from './constants.js';
import type { Facts } from './call.js';

export const SAVE_SIZE_RULES: DecideRule<Facts>[] = [
  {
    when: { bytes: { gt: FIRESTORE_MAX_ENVELOPE_BYTES } },
    then: 'refuse',
    label: 'Envelope exceeds the document envelope ceiling; nothing may be written',
  },
];
export const OUTCOME_RULES: DecideRule<Facts>[] = [
  {
    when: { failed: { eq: true } },
    then: 'refuse',
    label: 'The operation refused; preserve its original error',
  },
];
export const READ_RULES: DecideRule<Facts>[] = [
  ...OUTCOME_RULES,
  {
    when: { present: { eq: false } },
    then: 'absent',
    label: 'The snapshot has no row; only this is a fresh start',
  },
];
export const READY = { branch: 'complete', label: 'The operation completed' };
export const PRESENT = { branch: 'decode', label: 'A row exists; validate the stored envelope' };
export const WRITE = {
  branch: 'write',
  label: 'The canonical owner rule permits replacing this document',
};
