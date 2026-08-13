/**
 * examples/README.md auto-generator — Block E (v2.5).
 *
 * 7-pattern matrix-lite. Pins:
 *   - Generator runs to completion without error
 *   - Output is idempotent: a second run produces identical content
 *   - --check mode succeeds when README is up to date
 *   - --check mode fails (non-zero exit) when README is stale
 *   - Required AUTO-GENERATED markers exist in README
 *   - Every example file with a `meta` export appears in the generated table
 *   - Hand-written prose around the markers is preserved (no clobber)
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../..');
const README_PATH = join(REPO_ROOT, 'examples/README.md');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts/generate-examples-readme.mjs');
const START_MARKER = '<!-- AUTO-GENERATED:examples:start -->';
const END_MARKER = '<!-- AUTO-GENERATED:examples:end -->';

function runGenerator(args: readonly string[] = []): { code: number; out: string; err: string } {
  try {
    const out = execFileSync('node', [SCRIPT_PATH, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: err.status ?? 1,
      out: typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString() ?? '',
      err: typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? '',
    };
  }
}

// ─── 1. UNIT — generator runs ─────────────────────────────────────

describe('Block E — generator runs', () => {
  it('script exits 0 in regenerate mode', () => {
    const { code } = runGenerator();
    expect(code).toBe(0);
  });

  it('script exits 0 in --check mode after regeneration', () => {
    runGenerator(); // regenerate
    const { code } = runGenerator(['--check']);
    expect(code).toBe(0);
  });
});

// ─── 2. SCENARIO — markers + idempotence ──────────────────────────

describe('Block E — markers + idempotence', () => {
  it('README contains both AUTO-GENERATED markers after regeneration', () => {
    runGenerator();
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain(START_MARKER);
    expect(readme).toContain(END_MARKER);
  });

  it('output is idempotent — second run produces identical content', () => {
    runGenerator();
    const first = readFileSync(README_PATH, 'utf-8');
    runGenerator();
    const second = readFileSync(README_PATH, 'utf-8');
    expect(second).toBe(first);
  });
});

// ─── 3. INTEGRATION — coverage of meta'd examples ─────────────────

describe('Block E — example coverage', () => {
  it('every example with `meta` appears in the generated table', () => {
    runGenerator();
    const readme = readFileSync(README_PATH, 'utf-8');
    // Spot-check a few canonical example file references
    expect(readme).toContain('01-llm-call.ts');
    expect(readme).toContain('01-instruction.ts');
    expect(readme).toContain('05-dynamic-react.ts');
    expect(readme).toContain('01-window-strategy.ts');
  });

  it('hand-written prose around markers is preserved', () => {
    runGenerator();
    const readme = readFileSync(README_PATH, 'utf-8');
    // Spot-check some prose that should NOT be clobbered
    expect(readme).toContain('agentfootprint — examples');
    expect(readme).toContain('DNA progression');
    expect(readme).toContain('closed taxonomy');
  });
});

// ─── 5. SECURITY — --check fails on staleness ─────────────────────

describe('Block E — --check mode catches drift', () => {
  it('--check exits non-zero when README is stale, then regenerate fixes it', () => {
    // Pre: README is up to date
    runGenerator();

    const original = readFileSync(README_PATH, 'utf-8');
    try {
      // Introduce drift: append a stale marker comment inside the
      // auto-section so the regenerator's diff detects it.
      const drifted = original.replace(START_MARKER, `${START_MARKER}\nSTALE_DRIFT_MARKER`);
      writeFileSync(README_PATH, drifted, 'utf-8');

      const { code, err } = runGenerator(['--check']);
      expect(code).toBe(1);
      expect(err).toContain('OUT OF DATE');
    } finally {
      // Restore
      writeFileSync(README_PATH, original, 'utf-8');
    }

    // Post-restore, --check passes again
    const { code } = runGenerator(['--check']);
    expect(code).toBe(0);
  });
});

// ─── 6. REGRESSION — concatenated meta strings are captured whole ─
//
// The truncated-row bug class (second instance, after example 44's
// quote-delimiter bug): `fieldOf` used to stop at the FIRST closing
// quote, so a `'…' + '…'` description silently shipped as its first
// fragment — a row that read as a complete sentence while --check
// kept passing. Examples 55, 22, and observability 02/03 all use the
// concatenated form; pin their rows end-to-end AND pin the extractor
// against a synthetic fixture so the pin survives example rewording.

describe('Block E — concatenated meta descriptions are never truncated', () => {
  it('the four real concatenated descriptions render their FULL text', () => {
    runGenerator();
    const readme = readFileSync(README_PATH, 'utf-8');
    // Each assertion is the FINAL clause of a `+`-concatenated
    // description — present only if every fragment was joined.
    expect(readme).toContain('the fabrication trap.'); // features/55
    expect(readme).toContain('served by one bounded content-hash cache.'); // features/22
    expect(readme).toContain('all offline via the mock embedder.'); // observability/02
    expect(readme).toContain('the CI-gate workflow of agentfootprint-lint-tools.'); // observability/03
  });

  it('a fixture with mixed-quote concatenation renders whole, and cleanup restores the README', () => {
    runGenerator();
    const original = readFileSync(README_PATH, 'utf-8');
    const fixturePath = join(REPO_ROOT, 'examples/features/98-tmp-concat-fixture.ts');
    const fixture = [
      "import type { ExampleMeta } from '../helpers/cli.js';",
      '',
      'export const meta: ExampleMeta = {',
      "  id: 'features/98-tmp-concat-fixture',",
      "  title: 'Concat fixture — ' + 'joined title',",
      "  group: 'features',",
      '  description:',
      '    \'first fragment with an "inner quote" \' +',
      '    "second fragment with an \'apostrophe\' " +',
      "    'third fragment ends the sentence.',",
      '  defaultInput: null,',
      '  providerSlots: [],',
      "  tags: ['fixture'],",
      '};',
      '',
    ].join('\n');
    try {
      writeFileSync(fixturePath, fixture, 'utf-8');
      runGenerator();
      const readme = readFileSync(README_PATH, 'utf-8');
      expect(readme).toContain('Concat fixture — joined title');
      expect(readme).toContain(
        'first fragment with an "inner quote" ' +
          "second fragment with an 'apostrophe' " +
          'third fragment ends the sentence.',
      );
    } finally {
      rmSync(fixturePath, { force: true });
      runGenerator();
    }
    // Post-cleanup the README is byte-identical to the pre-fixture state.
    expect(readFileSync(README_PATH, 'utf-8')).toBe(original);
  });
});

// ─── 6b. REGRESSION — duplicate example numbers are REFUSED ───────
//
// The number-collision bug class: a new example landed as
// features/21-artifacts.ts next to 21-deferred-observers.ts and the
// generator happily shipped two rows both labeled "| 21 |" — --check
// stayed green because the README faithfully mirrored the ambiguous
// tree. The generator now refuses (BOTH modes) any collision that is
// not on its explicit committed-debt grandfather list, naming the
// colliding files and the folder's next free number.

describe('Block E — duplicate example numbers are refused', () => {
  const fixtureA = join(REPO_ROOT, 'examples/features/97-tmp-collision-a.ts');
  const fixtureB = join(REPO_ROOT, 'examples/features/97-tmp-collision-b.ts');

  it('a new number collision fails BOTH modes with a teaching message and never writes the README', () => {
    runGenerator(); // pre: README up to date
    const original = readFileSync(README_PATH, 'utf-8');
    try {
      writeFileSync(fixtureA, '// collision fixture (a)\n', 'utf-8');
      writeFileSync(fixtureB, '// collision fixture (b)\n', 'utf-8');

      const check = runGenerator(['--check']);
      expect(check.code).toBe(1);
      expect(check.err).toContain('one number must name ONE example');
      expect(check.err).toContain('97-tmp-collision-a.ts');
      expect(check.err).toContain('97-tmp-collision-b.ts');
      // Next free number = highest in the folder (the 97 fixtures) + 1.
      expect(check.err).toContain('Next free number in features/: 98');

      const regen = runGenerator();
      expect(regen.code).toBe(1);
      // The refusal fired BEFORE any write — no ambiguous table shipped.
      expect(readFileSync(README_PATH, 'utf-8')).toBe(original);
    } finally {
      rmSync(fixtureA, { force: true });
      rmSync(fixtureB, { force: true });
      runGenerator();
    }
    // Post-cleanup the README is byte-identical and --check is green again.
    expect(readFileSync(README_PATH, 'utf-8')).toBe(original);
    expect(runGenerator(['--check']).code).toBe(0);
  });

  it('grandfathered committed collisions still exist as listed (the ledger only shrinks)', () => {
    // These are the collisions that were already committed when the refusal
    // landed; the generator grandfathers EXACTLY these. Renaming one makes
    // the generator refuse with a stale-ledger message until its row is
    // deleted from scripts/generate-examples-readme.mjs — this pin makes
    // the same change fail loudly here too, so ledger and tree move together.
    const grandfathered = [
      'examples/features/06-detached-observability.ts',
      'examples/features/06-flowchart-boundary-payloads.ts',
      'examples/features/06-status-subpath.ts',
      'examples/features/06-tool-args-validation.ts',
      'examples/observability/13-context-error-finders.ts',
      'examples/observability/13-per-loop-trajectory.ts',
    ];
    for (const rel of grandfathered) {
      expect(existsSync(join(REPO_ROOT, rel)), `${rel} should exist`).toBe(true);
    }
    // With only the ledgered debt present, the generator is green.
    runGenerator();
    expect(runGenerator(['--check']).code).toBe(0);
  });

  it('the 21-artifacts collision itself stays fixed: the example lives at 56', () => {
    expect(existsSync(join(REPO_ROOT, 'examples/features/56-artifacts.ts'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'examples/features/21-artifacts.ts'))).toBe(false);
    runGenerator();
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain('56-artifacts.ts');
    expect(readme).not.toContain('21-artifacts.ts');
  });
});

// ─── 7. ROI — table shape is per-folder ───────────────────────────

describe('Block E — ROI: per-folder tables', () => {
  it('generated section contains the expected folder headings', () => {
    runGenerator();
    const readme = readFileSync(README_PATH, 'utf-8');
    const startIdx = readme.indexOf(START_MARKER);
    const endIdx = readme.indexOf(END_MARKER);
    const generated = readme.slice(startIdx, endIdx);

    // Folder headings as Markdown ### lines
    expect(generated).toMatch(/### \[`core\/`\]/);
    expect(generated).toMatch(/### \[`core-flow\/`\]/);
    expect(generated).toMatch(/### \[`patterns\/`\]/);
    expect(generated).toMatch(/### \[`context-engineering\/`\]/);
    expect(generated).toMatch(/### \[`memory\/`\]/);
    expect(generated).toMatch(/### \[`features\/`\]/);
  });

  it('generated tables include the | # | File | Title | Description | header', () => {
    runGenerator();
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain('| # | File | Title | Description |');
  });
});
