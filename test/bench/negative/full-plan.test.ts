import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
// @ts-expect-error Standalone benchmark module.
import { buildPlan, privatePath, ROOT, rowId } from '../../../bench/negative/full/plan.mjs';
// @ts-expect-error Standalone benchmark module.
import { argsOf, atomicWrite, completedArtifact } from '../../../bench/negative/full/run.mjs';

const bank = () =>
  Array.from({ length: 24 }, (_, i) => ({
    id: `synthetic-${i}`,
    sonnet: i < 12,
    ...(i < 8 ? { longContext: {} } : {}),
    ...(i < 6 ? { near: {} } : {}),
  }));

describe('registered full-path schedule', () => {
  it('keeps every approved cell and every repetition, with deterministic opaque identities', () => {
    const plan = buildPlan(bank());
    expect(plan).toHaveLength(784);
    expect(new Set(plan.map((r: { id: string }) => r.id)).size).toBe(784);
    expect(buildPlan(bank())).toEqual(plan);
    const count = (family: string, cell: string, arm: string) =>
      plan.filter(
        (r: { family: string; cell: string; arm: string }) =>
          r.family === family && r.cell === cell && r.arm === arm,
      ).length;
    expect(count('haiku', 'main', 'observe')).toBe(240);
    expect(count('haiku', 'main', 'enforce')).toBe(240);
    expect(count('sonnet', 'main', 'observe')).toBe(72);
    expect(count('sonnet', 'main', 'enforce')).toBe(72);
    expect(count('haiku', 'long', 'enforce')).toBe(40);
    expect(count('haiku', 'near', 'near-count')).toBe(60);
    expect(count('haiku', 'near', 'near-list')).toBe(60);
  });
  it('refuses smaller or duplicated banks and incomplete subsets', () => {
    expect(() => buildPlan(bank().slice(1))).toThrow('24');
    const duplicate = bank();
    duplicate[1].id = duplicate[0].id;
    expect(() => buildPlan(duplicate)).toThrow('distinct');
    const subset = bank();
    subset[0].sonnet = false;
    expect(() => buildPlan(subset)).toThrow('subsets');
  });
  it('does not collide when fields contain a delimiter', () => {
    expect(rowId({ model: 'x/y', cell: 'z', arm: 'a', caseId: 'b', rep: 1 })).not.toBe(
      rowId({ model: 'x', cell: 'y/z', arm: 'a', caseId: 'b', rep: 1 }),
    );
  });
  it('refuses private data inside the repository, even at a new nested path', () => {
    expect(() => privatePath(ROOT)).toThrow('outside');
    expect(() => privatePath(join(ROOT, 'untracked-private', 'cases.json'))).toThrow('outside');
  });
  it('requires an explicit run mode and rejects duplicated or unknown flags', () => {
    expect(() => argsOf([])).toThrow();
    expect(() => argsOf(['--mode', 'run', '--mode', 'mock'])).toThrow('Repeated');
    expect(() => argsOf(['--publish', 'yes'])).toThrow();
    expect(
      argsOf(['--mode', 'prepare', '--bank', '/private/cases', '--out', '/private/run'])[
        'accept-ai-bank'
      ],
    ).toBeUndefined();
  });
  it('refuses a derived output symlink into the repository before writing private data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'negative-path-'));
    try {
      symlinkSync(ROOT, join(dir, 'raw'), 'dir');
      expect(() => atomicWrite(join(dir, 'raw', 'private-trial.json'), 'private')).toThrow(
        'outside',
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it('does not treat a truncated completed artifact as a resumable success', () => {
    const dir = mkdtempSync(join(tmpdir(), 'negative-artifact-'));
    try {
      const path = join(dir, 'trial.json.gz');
      writeFileSync(path, Buffer.from([31, 139, 8]));
      expect(() => completedArtifact(path, {}, true)).toThrow();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
