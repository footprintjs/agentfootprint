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
 * WHAT IS SCANNED (`scanTree`, `textsOf`): every path `git ls-files` lists,
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
 * `/tmp/claude-<digits>` or `/private/tmp/claude-<digits>`, with the folder
 * after it. A name is the WHOLE folder name, up to the next `/`, `\` or line
 * break: a space, a quote, a NUL or a non-ASCII letter is part of it, and each
 * byte is read as one character, so no name is ever cut short. A name that
 * starts with a space, a quote, a bracket or one of `< > $ * | , ; :` is a
 * placeholder or punctuation (`/Users/<name>`, `/home/$USER`), not an account.
 *
 * THE ALLOW-LIST (`ALLOWED`): a file, why it may name such a path, and the
 * names it may use. A test that proves a path is never leaked needs a fake
 * one; its entry pins the fake names, compared whole, so a real one pasted
 * into the same file still fails, and so does a longer name that starts with a
 * pinned one (write a fake path with a `/` right after the name). The one
 * whole-file entry is the owner's own tool configuration. It is a `Map`, so a
 * file named after an inherited object key (`constructor`, `__proto__`) is
 * never in it.
 *
 * WHAT A GREEN RUN PROVES: no tracked file in the checked-out tree names a
 * local machine path outside the allow-list, and every allow-list entry and
 * pinned name is still in use.
 * WHAT IT DOES NOT PROVE: that history is clean. A value removed from the tree
 * stays in git history; this guard keeps new ones out. Nor other shapes: a
 * `~/` path, a bare user name, macOS's per-user temp folder (`/var/folders/…`),
 * or a file in UTF-16 or another encoding that does not keep ASCII as bytes.
 *
 * Test types:
 *   - UNIT     — the detector finds each kind and the WHOLE name it carries,
 *                leaves placeholders and look-alikes alone, and gives a
 *                finding's line; a gzip file, a symlink and a file holding a
 *                NUL are read as described;
 *   - SECURITY — no tracked file names a local machine path outside the
 *                allow-list; and, in throwaway git trees, a file named after an
 *                inherited key is not allowed, a pinned fake name counts only
 *                whole (whatever follows it, read raw, after a NUL or from
 *                gzip), and a name that starts with a non-ASCII letter is found;
 *   - DRIFT    — every allow-list entry, and every name it pins, is still used.
 */
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '..', '..');
const THIS_FILE = 'test/architecture/noLocalMachinePaths.test.ts';

/** A file that may name a local machine path, why, and the names it may use. */
interface Allowance {
  readonly reason: string;
  /** The only names it may use, each compared whole. Absent: the whole file is allowed. */
  readonly names?: readonly string[];
}

/** Keyed by the file's path. A `Map`, so `get` finds only these entries, never an inherited key. */
const ALLOWED: ReadonlyMap<string, Allowance> = new Map<string, Allowance>([
  [
    '.claude/settings.json',
    {
      reason:
        "the owner's Claude Code settings: `additionalDirectories` lists folders on the owner's " +
        "machine. It is the owner's tool configuration, so it stays as the owner set it.",
    },
  ],
  [
    'test/adapters/google/google-identity.test.ts',
    {
      reason:
        'a fake credentials-file path in a thrown error, to prove the adapter never repeats it',
      names: ['someone'],
    },
  ],
  [
    'test/adapters/identity/entra-identity.test.ts',
    {
      reason: 'a fake `.env` path in a thrown error, to prove the adapter never repeats it',
      names: ['x'],
    },
  ],
  [
    'test/bench/recordedDir.test.ts',
    {
      reason: 'fake folders outside the repo, to prove a bench result records none of them',
      names: ['example-person', 'someone', 'ci', 'claude-501/-Users-someone-repo'],
    },
  ],
  [
    THIS_FILE,
    {
      reason: "this guard's own detector cases",
      names: ['someone', 'claude-501', 'claude-501/-Users-someone-repo'],
    },
  ],
]);

/** One local machine path found in a text. */
interface Finding {
  readonly kind: 'home folder' | 'session scratch folder';
  /** What the path names, whole: the home folder's name, or `claude-<n>[/<project folder>]`. */
  readonly name: string;
  /** 1-based. */
  readonly line: number;
}

/**
 * The first character of a folder name: not a control character, a space, a
 * separator, or a character that opens a placeholder or ends a quoted string,
 * so `/Users/<name>`, `/home/$USER` and a `/Users/` in prose are not accounts.
 * Every byte from 0x80 up qualifies: a name may start with a non-ASCII letter.
 */
const NAME_START = String.raw`[^\x00-\x20\x7f\/\\<>"'\`*$|{}()\[\],;:]`;
/**
 * The rest of a folder name: everything up to the next separator or line
 * break. A space, a quote, a NUL or a non-ASCII letter is part of it, so a
 * name is read whole and a pinned fake name never matches a longer one.
 */
const NAME_REST = String.raw`[^\/\\\n\r]*`;
const NAME = NAME_START + NAME_REST;

/**
 * The three shapes, one alternative each. A home folder must START a path: the
 * character before it may not continue a word, a host or a relative path
 * (`@/components/home/v2`, `https://example.com/home/x`), but it may be `/`, so
 * `file:///Users/<name>/` is found. A Windows home takes one or two
 * backslashes, so a path written inside a string literal is found too. A
 * scratch folder is named with the folder after it, which names the project.
 */
const LOCAL_MACHINE_PATH = new RegExp(
  [
    String.raw`(?<![\w.@~-])\/(?:Users|home)\/(?<home>${NAME})`,
    String.raw`(?<!\w)[A-Za-z]:\\{1,2}Users\\{1,2}(?<windows>${NAME})`,
    String.raw`\/tmp\/(?<scratch>claude-\d${NAME_REST}(?:\/${NAME})?)`,
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

/** `git` in `cwd`, never steered by a `GIT_*` variable of the caller's (a hook's index, say). */
function git(cwd: string, args: readonly string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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

/**
 * Every local machine path in every file `root` tracks. Fails outside a git
 * checkout: a tree nothing could list is not a clean one.
 */
function scanTree(root: string): { tracked: string[]; found: Located[] } {
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  const found = tracked.flatMap((file) =>
    textsOf(root, file).flatMap(({ where, text }) =>
      localMachinePaths(text).map((finding) => ({ ...finding, file, where })),
    ),
  );
  return { tracked, found };
}

function isAllowed({ file, name }: Located): boolean {
  const allowance = ALLOWED.get(file);
  return allowance !== undefined && (allowance.names?.includes(name) ?? true);
}

/** What a failure prints for each path outside the allow-list: file, line and kind. Never the name. */
function offenders(found: readonly Located[]): string[] {
  return found
    .filter((finding) => !isAllowed(finding))
    .map(({ where, line, kind }) => `${where}:${line} (${kind})`);
}

/** `use` on a throwaway git repository that tracks `files` (each a path, then text or bytes). */
function withTrackedTree<T>(
  files: readonly (readonly [string, string | Buffer])[],
  use: (root: string) => T,
): T {
  const root = mkdtempSync(join(tmpdir(), 'local-paths-tree-'));
  try {
    git(root, ['init', '-q']);
    for (const [file, content] of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), content);
    }
    git(root, ['add', '--', ...files.map(([file]) => file)]);
    return use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const reportFor = (files: readonly (readonly [string, string | Buffer])[]): string[] =>
  withTrackedTree(files, (root) => offenders(scanTree(root).found));

describe('UNIT — the detector', () => {
  it.each([
    ['/Users/someone/project/notes.md', 'home folder', 'someone'],
    ['cat /home/someone/.env', 'home folder', 'someone'],
    ['file:///Users/someone/x', 'home folder', 'someone'],
    ['node --env-file=/Users/someone/.env run.mjs', 'home folder', 'someone'],
    ['C:\\Users\\someone\\x', 'home folder', 'someone'],
    ['/tmp/claude-501/', 'session scratch folder', 'claude-501'],
    [
      '/private/tmp/claude-501/-Users-someone-repo/0000/scratchpad',
      'session scratch folder',
      'claude-501/-Users-someone-repo',
    ],
    // A name is read whole, to the next separator or line break. The cases below are written with
    // \u escapes so that this file's own text shows the guard only the pinned fake name.
    ['/Users/someone\u0020personal/key', 'home folder', 'someone\u0020personal'],
    ['/Users/someone\u00e9/key', 'home folder', 'someone\u00e9'],
    ['/Users/someone\u0027 and more', 'home folder', "someone' and more"],
    ['/Users/\u00e9xample/key', 'home folder', '\u00e9xample'],
    ['C:\\Users\\someone\u0020personal\\key', 'home folder', 'someone\u0020personal'],
    ['C:\\Users\\\u00e9xample\\key', 'home folder', '\u00e9xample'],
    ['/tmp/claude-501\u0078/', 'session scratch folder', 'claude-501x'],
  ])('%s is a %s named %s', (text, kind, name) => {
    expect(localMachinePaths(text)).toEqual([{ kind, name, line: 1 }]);
  });

  it.each([
    "import { X } from '@/components/home/v2/X';",
    'https://example.com/home/someone/ and https://example.com/Users/someone/',
    'placeholders: /Users/<name>/, /home/$USER/, C:\\Users\\<name>\\, /tmp/claude-<n>/, /tmp/claude-…',
    'a /home page, a /Users list, and `/Users/` in prose',
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

describe('SECURITY — the allow-list, in throwaway git trees', () => {
  const GOOGLE_FIXTURE = 'test/adapters/google/google-identity.test.ts';

  it('a tracked file named after an inherited object key is not allowed by that key', () => {
    const account = 'inherited-key-probe';
    const report = reportFor(
      ['constructor', 'toString', '__proto__'].map(
        (file) => [file, `cat /Users/${account}/key\n`] as const,
      ),
    );
    expect(report.sort()).toEqual([
      '__proto__:1 (home folder)',
      'constructor:1 (home folder)',
      'toString:1 (home folder)',
    ]);
    expect(
      report.some((line) => line.includes(account)),
      'a report line names the account',
    ).toBe(false);
  });

  it.each([
    ['a space after it', '/Users/someone\u0020personal/key'],
    ['a non-ASCII letter after it', '/Users/someone\u00e9/key'],
    ['a space after it, in the Windows form', 'C:\\Users\\someone\u0020personal\\key'],
    ['a non-ASCII letter after it, in the Windows form', 'C:\\Users\\someone\u00e9\\key'],
  ])('a pinned fake name counts only whole: one with %s is reported', (_, path) => {
    expect(reportFor([[GOOGLE_FIXTURE, `throw new Error('${path}');\n`]])).toEqual([
      `${GOOGLE_FIXTURE}:1 (home folder)`,
    ]);
  });

  it('a name that starts with a non-ASCII letter is found in an unlisted file, in both forms', () => {
    expect(
      reportFor([['notes.md', '/Users/\u00e9xample/key\nC:\\Users\\\u00e9xample\\key\n']]),
    ).toEqual(['notes.md:1 (home folder)', 'notes.md:2 (home folder)']);
  });

  it('nothing after a pinned fake name lets it through, read raw, after a NUL or from gzip', () => {
    // Every character that can follow a folder name, except a separator or a line break: those end it.
    const after = [
      ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(0x20 + i)).filter(
        (c) => c !== '/' && c !== '\\',
      ),
      ...['\t', '\0', '\x0b', '\x0c', '\x1b', '\x7f'],
      ...[
        '\u0085',
        '\u00a0',
        '\u00e9',
        '\u0301',
        '\u2026',
        '\u2028',
        '\u3000',
        '\ufeff',
        '\u{1f600}',
      ],
    ];
    const linesFor = (name: string): string[] =>
      after.flatMap((c) =>
        name.startsWith('claude-')
          ? [`/tmp/${name}${c}x/key`]
          : [`/Users/${name}${c}x/key`, `/home/${name}${c}x/key`, `C:\\Users\\${name}${c}x\\key`],
      );
    const pinned = [...ALLOWED].filter(([, { names }]) => names !== undefined);
    const encodings: readonly (readonly [string, (text: string) => Buffer])[] = [
      ['raw', (text) => Buffer.from(text, 'utf8')],
      ['after a NUL', (text) => Buffer.from(`\0${text}`, 'utf8')],
      ['gzip', (text) => gzipSync(text)],
    ];
    for (const [how, encode] of encodings) {
      const files = pinned.map(
        ([file, { names = [] }]) => [file, names.flatMap(linesFor)] as const,
      );
      withTrackedTree(
        files.map(([file, lines]) => [file, encode(`${lines.join('\n')}\n`)] as const),
        (root) => {
          const found = scanTree(root).found.filter(
            ({ where }) => how !== 'gzip' || where.endsWith(' (decompressed)'),
          );
          expect(
            found.filter(isAllowed).length,
            `${how}: a longer name passed as a pinned one`,
          ).toBe(0);
          for (const [file, lines] of files)
            expect(found.filter((f) => f.file === file).length, `${how}: ${file}`).toBe(
              lines.length,
            );
        },
      );
    }
  });
});

describe('the tracked tree', () => {
  let tracked: string[] = [];
  let found: Located[] = [];

  beforeAll(() => {
    ({ tracked, found } = scanTree(REPO));
  }, 120_000);

  it('SECURITY — no tracked file names a local machine path outside the allow-list', () => {
    expect(tracked).toContain(THIS_FILE); // the listing reached this checkout's own files
    expect(
      offenders(found), // the name stays out of the log
      'Write a repo-relative path, or a placeholder such as /path/to/file or <file>. A test that ' +
        'proves a path is never leaked may use a fake name, pinned in ALLOWED with a reason. A ' +
        'name is read whole, up to the next / or line break, so write a / right after it.',
    ).toEqual([]);
  });

  it.each([...ALLOWED])(
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
