import { describe, expect, it } from 'vitest';
import { normalizeDependencySources } from '../../scripts/doc-source-links.mjs';

describe('generated dependency source links', () => {
  it('keeps checkout and linked-worktree output identical without disclosing machine paths', () => {
    const plain = 'Defined in: node\\_modules/footprintjs/dist/types/scope.d.ts:68';
    const linked =
      'Defined in: [../../private/build-cache/node\\_modules/footprintjs/dist/types/scope.d.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/../../private/build-cache/node_modules/footprintjs/dist/types/scope.d.ts#L68)';
    const unlinked =
      'Defined in: ../../private/build-cache/node\\_modules/footprintjs/dist/types/scope.d.ts:68';
    expect(normalizeDependencySources(linked)).toBe(plain);
    expect(normalizeDependencySources(unlinked)).toBe(plain);
    expect(normalizeDependencySources(plain)).toBe(plain);
  });

  it('retains source links into this repository and ordinary prose', () => {
    const own =
      'Defined in: [src/core/Agent.ts:515](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L515)';
    const prose = 'Use node_modules to resolve package definitions.';
    expect(normalizeDependencySources(`${own}\n\n${prose}`)).toBe(`${own}\n\n${prose}`);
  });
});
