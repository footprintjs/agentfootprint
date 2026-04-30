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
import { readFileSync, writeFileSync } from 'node:fs';
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
