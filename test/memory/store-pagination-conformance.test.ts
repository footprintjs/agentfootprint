import { describe, it } from 'vitest';
import { verifyOversizedListPagination } from './conformance/listPagination.js';
import { agentCorePagination } from './conformance/agentCoreFixture.js';
import { localPagination } from './conformance/localFixtures.js';
import { vectorPagination } from './conformance/vectorFixtures.js';
import { managedPagination } from './conformance/managedFixtures.js';

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
