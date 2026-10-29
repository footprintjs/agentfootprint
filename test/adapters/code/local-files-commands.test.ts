/**
 * `localCodeRunner` — reading a file back and running a command, on this
 * machine, with the same promises the sandbox adapter keeps.
 *
 * Real child processes and a real temp directory: the local runner's whole
 * value is that it is the real thing on a developer's machine, so its tests
 * run the real thing. The two seams (`_fs`, `_childProcess`) are used only to
 * produce what a real machine will not produce on demand — a file that grows
 * between its size check and its read, a child the runtime reports as aborted.
 */

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as realFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localCodeRunner, type FsModuleLike } from '../../../src/adapters/code/local.js';
import {
  canReadCodeFiles,
  canRunCodeCommands,
  CodeSandboxError,
  STAGED_INPUTS_ENV,
  type CodeSession,
} from '../../../src/index.js';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'af-local-files-'));
  outside = mkdtempSync(join(tmpdir(), 'af-local-outside-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const session = (options: Parameters<typeof localCodeRunner>[0] = {}): Promise<CodeSession> =>
  localCodeRunner({ cwd: root, ...options }).start({ key: 'k' });

// ─── readFile ────────────────────────────────────────────────────────────

describe('localCodeRunner.readFile — one file from the working directory, whole or not at all', () => {
  it('returns the exact BYTES on disk — a file is bytes, and no encoding is guessed', async () => {
    const bytes = Buffer.from('héllo, wörld\n', 'utf8');
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out', 'report.csv'), bytes);
    const s = await session();
    expect(canReadCodeFiles(s)).toBe(true);
    const file = await s.readFile?.('./out//report.csv', { maxBytes: 1_000 });
    expect(file?.path).toBe('out/report.csv');
    expect(file?.data).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(file?.data as Uint8Array).equals(bytes)).toBe(true);
    expect(file?.bytes).toBe(bytes.length);
    // Never guessed from the `.csv` extension.
    expect(file?.mediaType).toBeUndefined();
  });

  it('MAXBYTES — over it is refused whole with its size; exactly at it is returned whole', async () => {
    writeFileSync(join(root, 'eleven.txt'), 'x'.repeat(11));
    const s = await session();
    const err = await s.readFile?.('eleven.txt', { maxBytes: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodeSandboxError);
    expect(err).toMatchObject({
      reason: 'file-too-large',
      path: 'eleven.txt',
      bytes: 11,
      limit: 10,
    });
    const whole = await s.readFile?.('eleven.txt', { maxBytes: 11 });
    expect(whole?.bytes).toBe(11);
  });

  it('a file whose size is already over the bound is refused WITHOUT reading a byte of it', async () => {
    let reads = 0;
    const counting: FsModuleLike = {
      ...(realFs as unknown as FsModuleLike),
      readSync: (...args) => {
        reads++;
        return (realFs.readSync as unknown as NonNullable<FsModuleLike['readSync']>)(...args);
      },
    };
    writeFileSync(join(root, 'big.bin'), new Uint8Array(4_096));
    const s = await session({ _fs: counting });
    await expect(s.readFile?.('big.bin', { maxBytes: 4_095 })).rejects.toMatchObject({
      reason: 'file-too-large',
      bytes: 4_096,
    });
    expect(reads).toBe(0);
  });

  it('a file that GROWS between its size check and its read is refused, never cut', async () => {
    // A real machine will not grow a file on cue, so the fs seam does: the
    // size check says 4 bytes, the read keeps finding more.
    const grown: FsModuleLike = {
      ...(realFs as unknown as FsModuleLike),
      fstatSync: () => ({ isFile: () => true, size: 4 }),
      readSync: (_fd, buffer, offset, length) => {
        buffer.fill(120, offset, offset + length);
        return length;
      },
    };
    writeFileSync(join(root, 'growing.log'), 'abcd');
    const s = await session({ _fs: grown });
    await expect(s.readFile?.('growing.log', { maxBytes: 100 })).rejects.toMatchObject({
      reason: 'file-too-large',
      limit: 100,
    });
  });

  it('a LINK that leads outside the working directory is refused, not followed', async () => {
    writeFileSync(join(outside, 'secret.txt'), 'not yours');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'innocent.txt'));
    const s = await session();
    const err = await s.readFile?.('innocent.txt', { maxBytes: 1_000 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: 'path-refused', path: 'innocent.txt' });
    expect(String((err as Error).message)).not.toContain('not yours');
  });

  it('a link that stays inside is read like any file', async () => {
    writeFileSync(join(root, 'real.txt'), 'inside');
    symlinkSync(join(root, 'real.txt'), join(root, 'alias.txt'));
    const s = await session();
    const file = await s.readFile?.('alias.txt', { maxBytes: 100 });
    expect(Buffer.from(file?.data as Uint8Array).toString('utf8')).toBe('inside');
  });

  it('a missing file, and a directory, return nothing — by name', async () => {
    mkdirSync(join(root, 'adir'));
    const s = await session();
    await expect(s.readFile?.('nope.txt', { maxBytes: 10 })).rejects.toMatchObject({
      reason: 'file-not-returned',
    });
    await expect(s.readFile?.('adir', { maxBytes: 10 })).rejects.toMatchObject({
      reason: 'file-not-returned',
    });
  });

  it.skipIf(process.platform === 'win32')(
    'a NAMED PIPE the code made is refused — the read never waits for a writer',
    async () => {
      execFileSync('mkfifo', [join(root, 'pipe.csv')]);
      const s = await session();
      // A blocking open here would freeze this whole process, not just fail
      // the test: the refusal has to come before any wait.
      await expect(s.readFile?.('pipe.csv', { maxBytes: 100 })).rejects.toMatchObject({
        reason: 'file-not-returned',
        path: 'pipe.csv',
      });
    },
  );

  it('a read must name its bound', async () => {
    const s = await session();
    await expect(
      s.readFile?.('a.txt', { maxBytes: undefined as unknown as number }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

// ─── runCommand ──────────────────────────────────────────────────────────

describe('localCodeRunner.runCommand — opt-in, and only what the process reported', () => {
  it('is ABSENT unless the runner was built with commands: true', async () => {
    const plain = await session();
    expect(canRunCodeCommands(plain)).toBe(false);
    expect('runCommand' in plain).toBe(false);
    expect(canRunCodeCommands(await session({ commands: true }))).toBe(true);
  });

  it('returns the child’s own streams and exit status — nothing added to stderr', async () => {
    const s = await session({ commands: true });
    const out = await s.runCommand?.('echo out; echo err >&2; exit 3');
    expect(out).toEqual({ stdout: 'out\n', stderr: 'err\n', exitCode: 3 });
    expect(await s.runCommand?.('true')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('a child the operating system ENDED has no exit status — none is made up', async () => {
    const s = await session({ commands: true });
    const out = await s.runCommand?.('kill -9 $$');
    expect(out?.exitCode).toBeUndefined();
    expect('exitCode' in (out ?? {})).toBe(false);
  });

  it('output is bounded, the cut stated, and a checkpoint past the cut still seen', async () => {
    const s = await session({ commands: true });
    const out = await s.runCommand?.(
      'i=0; while [ $i -lt 200 ]; do echo row; i=$((i+1)); done; echo STEP_DONE',
      { maxOutputChars: 12, checkpoint: 'STEP_DONE' },
    );
    expect(out?.stdout).toBe('row\nrow\nrow\n');
    expect(out?.truncated).toEqual({ stdout: true, ofChars: 200 * 4 + 'STEP_DONE\n'.length });
    expect(out?.checkpointSeen).toBe(true);
    expect(out?.exitCode).toBe(0);
  });

  it('runs with the code’s environment ALLOWLIST, staged-input manifest included', async () => {
    process.env.AF_TEST_COMMAND_CANARY = 'leaked';
    try {
      const s = await session({ commands: true, _stagingRoot: outside });
      await s.stageInputs?.([{ name: 'dataset', data: '[1]' }]);
      const out = await s.runCommand?.(
        `printf '%s|%s' "\${AF_TEST_COMMAND_CANARY:-absent}" "$${STAGED_INPUTS_ENV}"`,
      );
      const [canary, manifest] = (out?.stdout ?? '').split('|');
      expect(canary).toBe('absent');
      expect(Object.keys(JSON.parse(manifest ?? '{}') as object)).toEqual(['dataset']);
      await s.stop();
    } finally {
      delete process.env.AF_TEST_COMMAND_CANARY;
    }
  });

  it('TIMEOUT kills the child and says so, without repeating the command', async () => {
    const s = await session({ commands: true });
    const err = await s.runCommand?.('sleep 5', { timeoutMs: 150 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodeSandboxError);
    expect((err as CodeSandboxError).reason).toBe('timed-out');
    expect((err as Error).message).not.toContain('sleep 5');
  });

  it('TIMEOUT is a real bound: a child that ignores SIGTERM is killed, never reported as success', async () => {
    const s = await session({ commands: true });
    const started = Date.now();
    const err = await s
      .runCommand?.('trap "" TERM; echo before; sleep 3; echo after; exit 0', { timeoutMs: 200 })
      .catch((e: unknown) => e);
    // Before this, the runtime's own timeout sent SIGTERM, waited for the
    // child, and — the child having ignored it and exited 0 — answered
    // `exitCode: 0` with stdout cut at the deadline.
    expect(err).toBeInstanceOf(CodeSandboxError);
    expect((err as CodeSandboxError).reason).toBe('timed-out');
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it('output past the buffer ceiling is a stated CUT with no exit status — not a missing shell', async () => {
    const s = await session({ commands: true });
    const out = await s.runCommand?.("head -c 34000000 /dev/zero | tr '\\0' x", {
      maxOutputChars: 10,
    });
    expect(out?.stdout).toBe('x'.repeat(10));
    // The runner ended the child at the ceiling: no exit status exists, and
    // the length before that cut was never seen, so no `ofChars` either.
    expect('exitCode' in (out ?? {})).toBe(false);
    expect(out?.truncated).toEqual({ stdout: true });
  });

  it('ABORT comes back as the caller’s own reason', async () => {
    const s = await session({ commands: true });
    const controller = new AbortController();
    const pending = s.runCommand?.('sleep 5', { signal: controller.signal });
    const reason = new Error('cancelled by the person');
    setTimeout(() => controller.abort(reason), 50);
    await expect(pending).rejects.toBe(reason);
  });
});

// ─── execute: the same honesty, fixed in the shared child runner ─────────

describe('localCodeRunner.execute — no invented exit status, no misnamed abort', () => {
  /** A child process whose callback reports exactly `error`. */
  const childReporting = (error: Record<string, unknown>) => ({
    execFile: (_f: unknown, _a: unknown, _o: unknown, callback: unknown): unknown => {
      (callback as (e: unknown, out: string, err: string) => void)(
        Object.assign(new Error('Command failed'), error),
        'partial',
        '',
      );
      return undefined;
    },
  });

  it('a child ended by a signal reports NO exit code (it used to report an invented 1)', async () => {
    const s = await session({ _childProcess: childReporting({ code: null, signal: 'SIGKILL' }) });
    const result = await s.execute({ code: 'x', language: 'javascript' });
    expect(result.ok).toBe(false);
    expect('exitCode' in result).toBe(false);
    expect(result.stdout).toBe('partial');
  });

  it('an aborted child rejects with the abort — not as a missing interpreter', async () => {
    const controller = new AbortController();
    const reason = new Error('stop');
    controller.abort(reason);
    const s = await session({
      _childProcess: childReporting({ code: 'ABORT_ERR', name: 'AbortError' }),
    });
    await expect(
      s.execute({ code: 'x', language: 'javascript', signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it('a real non-zero exit is still a RESULT with its own exit code', async () => {
    const s = await session();
    const result = await s.execute({ code: 'process.exit(4)', language: 'javascript' });
    expect(result).toMatchObject({ ok: false, exitCode: 4 });
  });

  it('an empty stderr stays empty — the runtime’s "Command failed: <the code>" is not passed off as it', async () => {
    const s = await session();
    const code = 'const secretMarker = 41; process.exit(secretMarker + 1)';
    const result = await s.execute({ code, language: 'javascript' });
    expect(result).toMatchObject({ ok: false, exitCode: 42, stderr: '' });
    expect(JSON.stringify(result)).not.toContain('secretMarker');
  });
});
