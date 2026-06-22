/**
 * ARCHITECTURE GUARDRAIL — the agentfootprint LIBRARY is UI-free.
 *
 * The published package must never gain a UI/render dependency. The docs app (docs-next/)
 * and the lens consume agentfootprint; the library must not depend on them — that inversion
 * is exactly the accidental mistake to prevent as more people contribute. This gates the
 * package.json side (a forbidden *declared* dep); the import side is gated by the
 * `no-restricted-imports` rule for src/** in .eslintrc.js. See docs/design/ui-boundary.md.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

// Exact names + patterns for UI/render packages that must never ship with the library.
const FORBIDDEN = new Set([
  'react',
  'react-dom',
  'next',
  'dagre',
  '@xyflow/react',
  'footprint-explainable-ui',
  'agentfootprint-lens',
]);
const FORBIDDEN_PATTERNS = [/^@xyflow\//, /^fumadocs/, /^footprint-explainable-ui\//, /^agentfootprint-lens\//];

const isForbidden = (name: string) => FORBIDDEN.has(name) || FORBIDDEN_PATTERNS.some((re) => re.test(name));

describe('architecture boundary: the library is UI-free', () => {
  // dependencies / peerDependencies / optionalDependencies are the SHIPPED contract — a UI
  // package in any of these reaches consumers. devDependencies are build-only and exempt.
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    it(`package.json#${field} declares no UI/render package`, () => {
      const offenders = Object.keys(pkg[field] ?? {}).filter(isForbidden);
      expect(
        offenders,
        `${field} must stay UI-free — these belong in docs-next/ or the lens, not the published library: ${offenders.join(', ')}`,
      ).toEqual([]);
    });
  }
});
