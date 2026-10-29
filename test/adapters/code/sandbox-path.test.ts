/**
 * ONE path rule, both adapters.
 *
 * `sandboxPath` is the port's rule for a path inside a code session: relative
 * to the working directory, never above it. It lives beside the port, and both
 * `localCodeRunner` and `agentCoreCodeRunner` call it before they read — so the
 * table below is run against EACH adapter, and a path one refuses the other
 * refuses too, before anything is read or sent.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { agentCoreCodeRunner } from '../../../src/adapters/code/agentcore.js';
import { localCodeRunner } from '../../../src/adapters/code/local.js';
import { CodeSandboxError, sandboxPath, type CodeSession } from '../../../src/index.js';

/** Every shape the rule refuses, with why. */
const REFUSED: readonly [string, string][] = [
  ['', 'empty'],
  ['.', 'the working directory itself'],
  ['./', 'the working directory itself'],
  ['a/..', 'the working directory itself'],
  ['/etc/passwd', 'absolute'],
  ['//server/share', 'absolute'],
  ['C:/Windows/win.ini', 'a drive'],
  ['c:relative', 'a drive'],
  ['~/.ssh/id_rsa', 'a home directory'],
  ['~', 'a home directory'],
  ['..', 'above the working directory'],
  ['../secret', 'above the working directory'],
  ['a/../../secret', 'above the working directory'],
  ['a/b/../../../secret', 'above the working directory'],
  ['./../secret', 'above the working directory'],
  ['out\\..\\..\\secret', 'a backslash'],
  ['out\\report.csv', 'a backslash'],
  ['report\0.csv', 'a NUL'],
];

/** Accepted, and the canonical form each is sent as. */
const ACCEPTED: readonly [string, string][] = [
  ['report.csv', 'report.csv'],
  ['out/report.csv', 'out/report.csv'],
  ['./out//report.csv', 'out/report.csv'],
  ['out/./report.csv', 'out/report.csv'],
  ['a/../b.csv', 'b.csv'],
  ['a/b/../c/./d.txt', 'a/c/d.txt'],
  ['out/', 'out'],
  ['...', '...'],
  ['a/~b', 'a/~b'],
  ['my report (final).csv', 'my report (final).csv'],
];

describe('sandboxPath — the one rule', () => {
  it.each(REFUSED)('refuses %j (%s) by name', (path) => {
    let caught: unknown;
    try {
      sandboxPath(path);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CodeSandboxError);
    expect(caught).toMatchObject({ reason: 'path-refused', code: 'ERR_CODE_SANDBOX', path });
  });

  it.each(ACCEPTED)('accepts %j as %j', (path, canonical) => {
    expect(sandboxPath(path)).toBe(canonical);
  });

  it('refuses what is not a string at all', () => {
    expect(() => sandboxPath(undefined as unknown as string)).toThrow(CodeSandboxError);
  });

  it('PROPERTY — a path is refused, or its canonical form stays inside and means the same file', () => {
    // A seeded walk over the segment shapes that matter. No path the rule
    // accepts may keep a `..`, a `.`, an empty segment or a leading `/`, and
    // the canonical form must resolve where the original resolves under a
    // root — so canonicalising never moves a read to another file.
    const pieces = ['a', 'b', '..', '.', '', 'c.txt', '~x', 'd'];
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    let accepted = 0;
    for (let n = 0; n < 5_000; n++) {
      const length = 1 + (next() % 6);
      const path = Array.from({ length }, () => pieces[next() % pieces.length]).join('/');
      let canonical: string;
      try {
        canonical = sandboxPath(path);
      } catch (err) {
        expect(err).toBeInstanceOf(CodeSandboxError);
        continue;
      }
      accepted++;
      const segments = canonical.split('/');
      expect(segments).not.toContain('..');
      expect(segments).not.toContain('.');
      expect(segments).not.toContain('');
      expect(posix.resolve('/root', canonical)).toBe(posix.resolve('/root', path));
      expect(posix.resolve('/root', canonical).startsWith('/root/')).toBe(true);
    }
    expect(accepted).toBeGreaterThan(500);
  });
});

describe('the SAME rule in both adapters — refused before anything is read or sent', () => {
  const root = mkdtempSync(join(tmpdir(), 'af-path-rule-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  let sent = 0;
  const adapters: readonly [string, () => Promise<CodeSession>][] = [
    [
      'localCodeRunner',
      () =>
        localCodeRunner({
          cwd: root,
          // Any filesystem touch would throw here: refusal must come first.
          _fs: {},
        }).start({ key: 'k' }),
    ],
    [
      'agentCoreCodeRunner',
      () =>
        agentCoreCodeRunner({
          identifier: 'aws.codeinterpreter.v1',
          _client: {
            startSession: () => Promise.resolve({ sessionId: 's1' }),
            invoke: () => {
              sent++;
              return Promise.resolve({ stdout: '', stderr: '' });
            },
            stopSession: () => Promise.resolve(),
          },
        }).start({ key: 'k' }),
    ],
  ];

  for (const [adapter, open] of adapters) {
    it.each(REFUSED)(`${adapter} refuses %j`, async (path) => {
      const session = await open();
      const before = sent;
      await expect(session.readFile?.(path, { maxBytes: 10 })).rejects.toMatchObject({
        reason: 'path-refused',
      });
      expect(sent).toBe(before);
    });
  }
});
