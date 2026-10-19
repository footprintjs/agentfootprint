import { describe, it } from 'vitest';
import { verifyOversizedListPagination } from './conformance/listPagination.js';
import { agentCorePagination } from './conformance/agentCoreFixture.js';
import { localPagination } from './conformance/localFixtures.js';
import { vectorPagination } from './conformance/vectorFixtures.js';
import { managedPagination } from './conformance/managedFixtures.js';
import {
  INVALID_REQUEST_LIMITS,
  verifyDefaultRequestLimits,
  verifyInvalidRequestLimit,
} from './conformance/requestLimits.js';

const HARNESSES = [
  ...localPagination,
  ...vectorPagination,
  ...managedPagination,
  agentCorePagination,
];
describe('MemoryStore conformance: oversized list limit and lossless continuation', () => {
  for (const harness of HARNESSES) {
    it(harness.name, () => verifyOversizedListPagination(harness));
  }
});

describe('MemoryStore conformance: caller request bounds', () => {
  for (const harness of HARNESSES) {
    describe(harness.name, () => {
      it('preserves omitted and explicit-undefined defaults and search availability', () =>
        verifyDefaultRequestLimits(harness));
      for (const invalid of INVALID_REQUEST_LIMITS) {
        it(`rejects ${invalid.label} list limit before backend work`, () =>
          verifyInvalidRequestLimit(harness, 'list', invalid.value));
        if (harness.supportsSearch) {
          it(`rejects ${invalid.label} search k before backend work and empty shortcuts`, () =>
            verifyInvalidRequestLimit(harness, 'search', invalid.value));
        }
      }
    });
  }
});
