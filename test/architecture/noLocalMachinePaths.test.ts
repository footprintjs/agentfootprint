/**
 * NO LOCAL MACHINE PATHS — no tracked file names a folder on someone's machine.
 *
 * WHY A TEST. A home folder, or a coding session's scratch folder, carries a
 * person's user name and the names of their own folders. Once committed, it
 * stays in this repository's history and in every clone. Review let several
 * in: a documented `--env-file=` path, absolute test paths in a design note,
 * and two tests that read a fixture from a personal folder (they now read the
 * path from an environment variable and skip without one).
 * `test/bench/recordedDir.test.ts` guards what the bench runners write; this
 * guard covers every tracked file.
 *
 * WHAT IS SCANNED (`listTracked`, `textsOf`): every path `git ls-files` lists,
 * read as raw bytes, so a text file that holds a NUL character (a few in
 * `src/` and `test/` do) is still read; a gzip file decompressed as well (the
 * bench keeps its recorded runs gzipped); a symlink as the path it points to,
 * which is what git stores. Nothing is skipped as binary or as generated: the
 * API pages under `docs-next/content/docs/api/` are published as they stand,
 * and a generator that wrote an absolute source path would leak it only there.
 * `git ls-files` never lists `node_modules`, which is ignored.
 *
 * WHAT COUNTS (`localMachinePaths`): a home folder, `/Users/<name>` or
 * `/home/<name>` at the start of a path (so not `@/components/home/…` and not a
 * URL's path), or `C:\Users\<name>`; and a session scratch folder,
 * `/tmp/claude-<n>` or `/private/tmp/claude-<n>`.
 *
 * THE ALLOW-LIST (`ALLOWED`): a file, why it may name such a path, and the
 * names it may use. A test that proves a path is never leaked needs a fake
 * one; its entry pins the fake names, so a real one pasted into the same file
 * still fails. The one whole-file entry is the owner's own tool configuration.
 *
 * WHAT A GREEN RUN PROVES: no tracked file in the checked-out tree names a
 * local machine path outside the allow-list, and every allow-list entry and
 * pinned name is still in use.
 * WHAT IT DOES NOT PROVE: that history is clean. A value removed from the tree
 * stays in git history; this guard keeps new ones out. Nor other shapes: a
 * `~/` path, a bare user name, macOS's per-user temp folder (`/var/folders/…`).
 *
 * Test types:
 *   - UNIT     — the detector finds each kind and the name it carries, leaves
 *                look-alikes alone, and gives a finding's line; a gzip file, a
 *                symlink and a file holding a NUL are read as described;
 *   - SECURITY — no tracked file names a local machine path outside the
 *                allow-list;
 *   - DRIFT    — every allow-list entry, and every name it pins, is still used.
 */
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '..', '..');
const THIS_FILE = 'test/architecture/noLocalMachinePaths.test.ts';

/** A file that may name a local machine path, why, and the names it may use. */
interface Allowance {
  readonly reason: string;
  /** The only names it may use. Absent: the whole file is allowed. */
  readonly names?: readonly string[];
}

const ALLOWED: Readonly<Record<string, Allowance>> = {
  '.claude/settings.json': {
    reason:
      "the owner's Claude Code settings: `additionalDirectories` lists folders on the owner's " +
      "machine. It is the owner's tool configuration, so it stays as the owner set it.",
  },
  'test/adapters/google/google-identity.test.ts': {
    reason: 'a fake credentials-file path in a thrown error, to prove the adapter never repeats it',
    names: ['someone'],
  },
  'test/adapters/identity/entra-identity.test.ts': {
    reason: 'a fake `.env` path in a thrown error, to prove the adapter never repeats it',
    names: ['x'],
  },
  'test/bench/recordedDir.test.ts': {
    reason: 'fake folders outside the repo, to prove a bench result records none of them',
    names: ['example-person', 'someone', 'ci', 'claude-501/-Users-someone-repo'],
  },
  [THIS_FILE]: {
    reason: "this guard's own detector cases",
    names: ['someone', 'claude-501', 'claude-501/-Users-someone-repo'],
  },
};

/** One local machine path found in a text. */
interface Finding {
  readonly kind: 'home folder' | 'session scratch folder';
  /** What the path names: the home folder's name, or `claude-<n>[/<project folder>]`. */
  readonly name: string;
  /** 1-based. */
  readonly line: number;
}

/**
 * The three shapes, one alternative each. A home folder must START a path: the
 * character before it may not continue a word, a host or a relative path
 * (`@/components/home/v2`, `https://example.com/home/x`), but it may be `/`, so
 * `file:///Users/…` is found. A Windows home takes one or two backslashes, so a
 * path written inside a string literal is found too.
 */
const LOCAL_MACHINE_PATH = new RegExp(
  [
    String.raw`(?<![\w.@~-])\/(?:Users|home)\/(?<home>[\w.-]+)`,
    String.raw`(?<!\w)[A-Za-z]:\\{1,2}Users\\{1,2}(?<windows>[\w.-]+)`,
    String.raw`\/tmp\/(?<scratch>claude-\w[\w.-]*(?:\/[\w.-]+)?)`,
  ].join('|'),
  'g',
);

function localMachinePaths(text: string): Finding[] {
  return [...text.matchAll(LOCAL_MACHINE_PATH)].map((match): Finding => {
    const { home, windows, scratch } = match.groups ?? {};
    return {
      kind: scratch === undefined ? 'home folder' : 'session scratch folder',
      name: home ?? windows ?? scratch ?? '',
      line: text.slice(0, match.index).split('\n').length,
    };
  });
}

/** Every path git tracks, relative to `root`. Fails outside a git checkout: nothing scanned is not "clean". */
function listTracked(root: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

/** What is read of one tracked file: its bytes, a gzip file's content too, a symlink's target. */
function textsOf(root: string, file: string): { where: string; text: string }[] {
  const path = join(root, file);
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch (error) {
    // Tracked but deleted from the working tree: there is nothing left to leak.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (stat.isSymbolicLink()) return [{ where: `${file} (link target)`, text: readlinkSync(path) }];
  if (!stat.isFile()) return []; // a submodule's folder
  const bytes = readFileSync(path);
  const texts = [{ where: file, text: bytes.toString('latin1') }];
  if (bytes[0] === 0x1f && bytes[1] === 0x8b)
    texts.push({ where: `${file} (decompressed)`, text: gunzipSync(bytes).toString('latin1') });
  return texts;
}

interface Located extends Finding {
  readonly file: string;
  readonly where: string;
}

function isAllowed({ file, name }: Located): boolean {
  const allowance = ALLOWED[file];
  return allowance !== undefined && (allowance.names?.includes(name) ?? true);
}

describe('UNIT — the detector', () => {
  it.each([
    ['/Users/someone/project/notes.md', 'home folder', 'someone'],
    ['cat /home/someone/.env', 'home folder', 'someone'],
    ['file:///Users/someone/x', 'home folder', 'someone'],
    ['node --env-file=/Users/someone/.env run.mjs', 'home folder', 'someone'],
    ["'/Users/someone'", 'home folder', 'someone'],
    ['C:\\Users\\someone\\x', 'home folder', 'someone'],
    ['/tmp/claude-501', 'session scratch folder', 'claude-501'],
    [
      '/private/tmp/claude-501/-Users-someone-repo/0000/scratchpad',
      'session scratch folder',
      'claude-501/-Users-someone-repo',
    ],
  ])('%s is a %s named %s', (text, kind, name) => {
    expect(localMachinePaths(text)).toEqual([{ kind, name, line: 1 }]);
  });

  it.each([
    "import { X } from '@/components/home/v2/X';",
    'https://example.com/home/someone/ and https://example.com/Users/someone/',
    'a placeholder: /Users/<name>/, /home/<name>/, C:\\Users\\<name>, /tmp/claude-…',
    'a /home page and a /Users list',
    'src/Users/list.ts and ./home/x',
    '/tmp/x and /private/tmp',
  ])('%s names nothing', (text) => {
    expect(localMachinePaths(text)).toEqual([]);
  });

  it('a finding carries its line', () => {
    expect(localMachinePaths('one\ntwo\nthree /home/someone/x')).toEqual([
      { kind: 'home folder', name: 'someone', line: 3 },
    ]);
  });
});

describe('UNIT — what is read of a file', () => {
  it('a gzip file is read decompressed too, a symlink as its target, a NUL does not stop the read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-paths-'));
    try {
      writeFileSync(join(dir, 'run.json.gz'), gzipSync('{"cwd":"/home/someone/x"}'));
      writeFileSync(join(dir, 'nul.ts'), 'a\u0000b /home/someone/x');
      symlinkSync('/home/someone/data', join(dir, 'link'));
      const found = (file: string) =>
        textsOf(dir, file).flatMap(({ where, text }) =>
          localMachinePaths(text).map((f) => `${where}: ${f.name}`),
        );
      expect(found('run.json.gz')).toContain('run.json.gz (decompressed): someone');
      expect(found('nul.ts')).toEqual(['nul.ts: someone']);
      expect(found('link')).toEqual(['link (link target): someone']);
      expect(textsOf(dir, 'deleted.md')).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the tracked tree', () => {
  let tracked: string[] = [];
  let found: Located[] = [];

  beforeAll(() => {
    tracked = listTracked(REPO);
    found = tracked.flatMap((file) =>
      textsOf(REPO, file).flatMap(({ where, text }) =>
        localMachinePaths(text).map((finding) => ({ ...finding, file, where })),
      ),
    );
  }, 120_000);

  it('SECURITY — no tracked file names a local machine path outside the allow-list', () => {
    expect(tracked).toContain(THIS_FILE); // the listing reached this checkout's own files
    const offenders = found
      .filter((f) => !isAllowed(f))
      .map(({ where, line, kind }) => `${where}:${line} (${kind})`); // the name stays out of the log
    expect(
      offenders,
      'Write a repo-relative path, or a placeholder such as /path/to/file or <file>. A test that ' +
        'proves a path is never leaked may use a fake name and pin it in ALLOWED, with a reason.',
    ).toEqual([]);
  });

  it.each(Object.entries(ALLOWED))(
    'DRIFT — %s is tracked and still uses what it is allowed',
    (file, { reason, names }) => {
      expect(reason.length).toBeGreaterThan(0);
      expect(tracked).toContain(file);
      const used = new Set(found.filter((f) => f.file === file).map((f) => f.name));
      expect(used.size, `${file} names no local path any more: remove its entry`).toBeGreaterThan(
        0,
      );
      for (const name of names ?? [])
        expect(used.has(name), `${file} no longer uses ${name}: remove it`).toBe(true);
    },
  );
});
