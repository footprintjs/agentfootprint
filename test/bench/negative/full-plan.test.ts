import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
// @ts-expect-error Standalone benchmark module.
import {
  buildPlan,
  digest,
  privatePath,
  ROOT,
  rowId,
  validateFrozen,
} from '../../../bench/negative/full/plan.mjs';
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

describe('disclosed processing amendment', () => {
  function fixture() {
    const bankBytes = 'private synthetic bank';
    const manifest = {
      bankSha256: digest(bankBytes),
      codeHashes: { 'bench/negative/full/rate.mjs': 'before', 'src/core/Agent.ts': 'runtime' },
      schedule: ['fixed'],
    };
    const current = { ...manifest.codeHashes, 'bench/negative/full/rate.mjs': 'reviewed' };
    const amendment = {
      kind: 'unsent-attempts-and-reserve/1',
      originalRegistrationSha256: digest(manifest),
      codeHashes: current,
      agentReserveMicro: 750_000,
      budgetUsd: 4.3,
      reason: 'Keep unsent attempts as failures and retain the total budget.',
    };
    return { bankBytes, manifest, current, amendment };
  }
  it('keeps the original reserve for unchanged registrations', () => {
    const { manifest, bankBytes } = fixture();
    expect(validateFrozen(manifest, bankBytes, manifest.codeHashes)).toBe(1_000_000);
  });
  it('accepts the exact disclosed processing revision without changing the manifest', () => {
    const { manifest, bankBytes, current, amendment } = fixture();
    const before = JSON.stringify(manifest);
    expect(validateFrozen(manifest, bankBytes, current, amendment)).toBe(750_000);
    expect(JSON.stringify(manifest)).toBe(before);
  });
  it.each([
    'src/core/Agent.ts',
    'bench/negative/full/harness.mjs',
    'bench/negative/full/labels.mjs',
    'bench/negative/full/score.mjs',
    'bench/negative/full/budget.mjs',
  ])('refuses changing %s even if an amendment claims its new hash', (path) => {
    const { manifest, bankBytes, current, amendment } = fixture();
    const tampered = { ...current, [path]: 'changed' };
    expect(() =>
      validateFrozen(manifest, bankBytes, tampered, { ...amendment, codeHashes: tampered }),
    ).toThrow('Frozen implementation');
  });
  it('refuses later edits to an allowed filename and unrelated registrations or banks', () => {
    const { manifest, bankBytes, current, amendment } = fixture();
    expect(() =>
      validateFrozen(
        manifest,
        bankBytes,
        { ...current, 'bench/negative/full/rate.mjs': 'later' },
        amendment,
      ),
    ).toThrow();
    expect(() =>
      validateFrozen({ ...manifest, schedule: ['different'] }, bankBytes, current, amendment),
    ).toThrow();
    expect(() => validateFrozen(manifest, 'different bank', current, amendment)).toThrow('bank');
    expect(() => validateFrozen(manifest, bankBytes, current)).toThrow();
  });
  it('cannot raise the total spending cap or discard the rating reserve', () => {
    const { manifest, bankBytes, current, amendment } = fixture();
    expect(() =>
      validateFrozen(manifest, bankBytes, current, { ...amendment, budgetUsd: 5 }),
    ).toThrow();
    expect(() =>
      validateFrozen(manifest, bankBytes, current, { ...amendment, agentReserveMicro: 0 }),
    ).toThrow();
  });
  it('binds the compatibility amendment to its unchanged parent and refuses execution changes', () => {
    const { manifest, bankBytes, current, amendment } = fixture();
    const compatible = { ...current, 'bench/negative/full/rate.mjs': 'compatible' };
    const next = {
      ...amendment,
      previousAmendmentSha256: digest(amendment),
      codeHashes: compatible,
    };
    expect(validateFrozen(manifest, bankBytes, compatible, next, amendment)).toBe(750_000);
    expect(() => validateFrozen(manifest, bankBytes, compatible, next)).toThrow('parent');
    expect(() =>
      validateFrozen(manifest, bankBytes, compatible, next, { ...amendment, reason: 'edited' }),
    ).toThrow('parent');
    const altered = { ...compatible, 'bench/negative/full/run.mjs': 'changed' };
    expect(() =>
      validateFrozen(manifest, bankBytes, altered, { ...next, codeHashes: altered }, amendment),
    ).toThrow('execution');
  });
});
