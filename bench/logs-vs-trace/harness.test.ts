import { describe, expect, it, vi } from 'vitest';
import { callTraceTool, traceToolpack } from '../../src/observe.js';
import { runValidation, planOf, MODE } from './harness.mjs';
import { bytesOf, evidenceFor, sha256 } from './evidence.mjs';
import { parseArgs } from './run.mjs';
import { captureCase } from './capture.mjs';
import { gradeFix } from './grade.mjs';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const doors = { callTraceTool, traceToolpack };
const localDoors = async () => doors;

describe('logs/trace deterministic harness boundaries', () => {
  it('refuses paid modes and unrecognized configuration before loading a door', async () => {
    const loadDoors = vi.fn(localDoors);
    await expect(runValidation({ mode: 'anthropic', loadDoors })).rejects.toThrow(/disabled/);
    await expect(runValidation({ provider: 'anthropic', loadDoors })).rejects.toThrow(
      /configuration/,
    );
    expect(loadDoors).not.toHaveBeenCalled();
  });

  it('does not execute configuration accessors or inherited options', async () => {
    const getter = vi.fn(() => MODE);
    const options = Object.defineProperty({}, 'mode', { get: getter });
    await expect(runValidation(options)).rejects.toThrow(/configuration/);
    await expect(runValidation(Object.create({ loadDoors: localDoors }))).rejects.toThrow(
      /configuration/,
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it('cross-checks native correct-chart decisions against the independent replay grader', async () => {
    const native = await captureCase(
      { variant: 'monthly', capture: 'complete' },
      { annualIncome: 60000, monthlyDebt: 500, creditScore: 679 },
    );
    expect(native.decision).toBe('refer');
    expect(native.dti).toBe(0.1);
    const grade = gradeFix({ operation: 'keep' }, { originalField: 'monthlyIncome' });
    const referral = grade.checks.find((check) => check.id === 'below-prime');
    expect(referral.expected.decision).toBe(native.decision);
    expect(referral.actual.decision).toBe(native.decision);
    expect(grade.status).toBe('checked-pass');
  });

  it('keeps returned candidate and task data detached from future runs', async () => {
    const first = await runValidation({ loadDoors: localDoors });
    first.rows[0].scriptedChecks[0].candidate.field = 'annualIncome';
    first.rows[0].evidence.task.responseShape.field = 'poisoned';
    const second = await runValidation({ loadDoors: localDoors });
    expect(second.rows[0].scriptedChecks[0].candidate.field).toBe('monthlyIncome');
    expect(second.rows[0].evidence.task.responseShape.field).not.toBe('poisoned');
  });

  it('has a fixed paired plan and refuses invalid seeds', () => {
    const a = planOf(1729);
    expect(a).toEqual(planOf(1729));
    expect(new Set(a.map((x) => `${x.caseId}/${x.arm}`)).size).toBe(6);
    expect(a.filter((x) => x.arm === 'trace')).toHaveLength(3);
    expect(a.filter((x) => x.arm === 'logs')).toHaveLength(3);
    for (const seed of [-1, 2 ** 32, 0.5, NaN, '1729']) expect(() => planOf(seed)).toThrow();
  });

  it('refuses every unsupported or paid CLI option', () => {
    for (const args of [
      ['--provider', 'anthropic'],
      ['--model', 'x'],
      ['--max-usd', '1'],
      ['--seed'],
      ['--seed', '-1'],
      ['--out'],
      ['--seed', '1', '--seed', '2'],
      ['--out', 'a', '--out', 'b'],
    ]) {
      expect(() => parseArgs(args)).toThrow();
    }
    expect(parseArgs(['--seed', '42']).seed).toBe(42);
  });

  it('frames evidence digests and counts UTF8 response bytes, never token estimates', async () => {
    const capture = {
      captureStatus: 'complete',
      artifacts: {},
      decision: 'approve',
      logs: 'é🙂',
      limitations: [],
    };
    const a = await evidenceFor('logs', capture, doors);
    expect(a.utf8BytesServed).toBe(6);
    expect(a.evidenceDigest).toBe(sha256(JSON.stringify(a.responses)));
    expect(bytesOf('é🙂')).toBe(6);
    expect(a).not.toHaveProperty('tokens');
  });

  it('keeps available ordinary logs visible when the paired trace record is missing', async () => {
    const capture = {
      captureStatus: 'missing',
      artifacts: undefined,
      logs: 'known log',
      limitations: [],
    };
    const load = { traceToolpack: vi.fn(), callTraceTool: vi.fn() };
    const logs = await evidenceFor('logs', capture, load);
    const trace = await evidenceFor('trace', capture, load);
    expect(logs.status).toBe('available');
    expect(logs.responses[0].content).toBe('known log');
    expect(trace.status).toBe('missing');
    expect(trace.evidenceDigest).toBeNull();
    expect(load.traceToolpack).not.toHaveBeenCalled();
    expect(load.callTraceTool).not.toHaveBeenCalled();
  });

  it('runs real completed native artifacts through the public trace tools, with no model', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network forbidden');
    });
    try {
      const result = await runValidation({ loadDoors: localDoors });
      expect(result.mode).toBe(MODE);
      expect(result.conclusion).toMatch(/Harness verification only/);
      expect(result.usage).toMatchObject({
        modelCalls: 0,
        providerCalls: 0,
        inputTokens: null,
        outputTokens: null,
        modelSpendUsd: 0,
      });
      expect(result.rows).toHaveLength(6);
      for (const caseId of new Set(result.rows.map((row) => row.caseId))) {
        const pair = result.rows.filter((row) => row.caseId === caseId);
        expect(pair[0].captureDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(pair[0].captureDigest).toBe(pair[1].captureDigest);
      }
      expect(network).not.toHaveBeenCalled();
      for (const row of result.rows) {
        const frame = row.evidence;
        expect(frame.task).not.toHaveProperty('oracle');
        expect(frame.task).not.toHaveProperty('correctFix');
        expect(frame.utf8BytesServed).toBe(
          frame.responses.reduce((n, response) => n + bytesOf(response.content), 0),
        );
        if (row.caseId === 'missing-record') {
          expect(row.scriptedChecks.every((x) => x.grade.status === 'not-graded')).toBe(true);
        } else {
          expect(frame.status).toBe('available');
          const monthly = row.scriptedChecks.find((x) => x.id === 'monthly-field');
          const annual = row.scriptedChecks.find((x) => x.id === 'annual-field');
          const keep = row.scriptedChecks.find((x) => x.id === 'keep');
          expect(monthly.grade.status).toBe('checked-pass');
          expect(annual.grade.status).toBe('checked-fail');
          expect(keep.grade.status).toBe(
            row.caseId === 'monthly-control' ? 'checked-pass' : 'checked-fail',
          );
          if (row.arm === 'trace') {
            expect(frame.toolCalls).toBe(8);
            expect(
              frame.responses.some((x) => x.tool === 'get_value' && x.content.includes('2310')),
            ).toBe(true);
            expect(
              frame.responses.some((x) => x.tool === 'get_value' && x.content.includes('5500')),
            ).toBe(true);
          }
        }
      }
    } finally {
      network.mockRestore();
    }
  });

  it('keeps the checked-in validation artifact internally auditable and explicitly non-empirical', () => {
    const saved = JSON.parse(readFileSync(new URL('./validation.json', import.meta.url), 'utf8'));
    expect(saved.mode).toBe(MODE);
    expect(saved.conclusion).toMatch(/No model debugging quality/);
    expect(saved.usage.inputTokens).toBeNull();
    expect(saved.usage.outputTokens).toBeNull();
    for (const row of saved.rows) {
      const frame = row.evidence;
      expect(frame.utf8BytesServed).toBe(
        frame.responses.reduce((n, response) => n + bytesOf(response.content), 0),
      );
      if (frame.status === 'available')
        expect(frame.evidenceDigest).toBe(sha256(JSON.stringify(frame.responses)));
      for (const script of row.scriptedChecks) {
        expect(script.grade).toEqual(
          gradeFix(script.candidate, {
            originalField: row.caseId === 'monthly-control' ? 'monthlyIncome' : 'annualIncome',
            captureStatus: row.caseId === 'missing-record' ? 'missing' : 'complete',
          }),
        );
      }
    }
  });

  it.skipIf(!existsSync(new URL('../../dist/esm/observe.js', import.meta.url)))(
    'exercises the actual CLI against the built public door in hosted CI and preserves existing output',
    () => {
      const cli = fileURLToPath(new URL('./run.mjs', import.meta.url));
      const dir = mkdtempSync(join(tmpdir(), 'af-logs-trace-'));
      const out = join(dir, 'validation.json');
      const stdout = execFileSync(process.execPath, [cli, '--out', out], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      expect(JSON.parse(stdout).mode).toBe(MODE);
      expect(readFileSync(out, 'utf8')).toBe(stdout);
      writeFileSync(out, 'preserved');
      const collision = spawnSync(process.execPath, [cli, '--out', out], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      expect(collision.status).toBe(1);
      expect(readFileSync(out, 'utf8')).toBe('preserved');
      const paid = spawnSync(process.execPath, [cli, '--provider', 'anthropic'], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      expect(paid.status).toBe(1);
      expect(paid.stderr).toMatch(/disabled/);
    },
  );
});
