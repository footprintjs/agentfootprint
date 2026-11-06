import type { TimeCandidate, TimePart } from '../resolveRecord.js';

export interface Built {
  readonly candidate: Omit<TimeCandidate, 'reader' | 'said' | 'parse'>;
  readonly said: readonly TimePart[];
}

export type Unresolved =
  | { readonly unsupported: string }
  | { readonly needsZone: true; readonly reason?: string };
