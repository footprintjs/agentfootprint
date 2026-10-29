/**
 * localCodeRunner — run code in a child process, on this machine.
 *
 * Pattern: Adapter (GoF) over `node:child_process`.
 * Role:    the dev default behind the {@link CodeRunner} port. `agentCoreCodeRunner`
 *          is the production swap; the tool code does not change.
 * Emits:   nothing. The tool that owns the session emits.
 *
 * ── ISOLATION, NOT A SANDBOX. Read this before deploying it. ────────────────
 * The name is `localCodeRunner`, never `sandboxedCodeRunner`, and the
 * difference is not modesty — it is the whole security posture.
 *
 * What a child process DOES give you:
 *   • a separate process and heap — a crash or an OOM takes the child, not you;
 *   • kill on timeout, so runaway code has a ceiling — on POSIX the child
 *     runs in a process group of its own, and at the timeout, on an abort or
 *     at the output ceiling the runner stops that OWNED group (SIGKILL). That
 *     is cleanup, not containment: a descendant that starts its own session
 *     or group escapes it, and a host killed before its exit handlers run
 *     stops nothing. On Windows only the child itself can be stopped, and the
 *     timeout error says so;
 *   • no inherited stdin, so nothing can block waiting for a terminal;
 *   • an environment ALLOWLIST — `process.env` is not inherited (only `PATH`,
 *     so the interpreter can be found), so an `AWS_SECRET_ACCESS_KEY` in your
 *     shell is not in the model's reach;
 *   • a working directory, by convention.
 *
 * What it does NOT give you, at all:
 *   • a filesystem jail — the code can read and write anywhere this process can;
 *   • a network jail — it can call out;
 *   • CPU or memory limits beyond the timeout;
 *   • any protection from code that deletes something outside `cwd`.
 *
 * ── It stages inputs; it does NOT report outputs (a decision, not a gap) ────
 * `stageInputs` puts declared artifact payloads INTO the session, and the code
 * reads them from the manifest. Nothing comes back the same way: this runner
 * leaves `CodeResult.artifacts` ABSENT — never `[]`, which would claim the code
 * produced nothing — because it has no output location to collect from. The
 * child's working directory is the CALLER'S OWN cwd, so "files the code wrote"
 * is not a set this adapter can identify without guessing which of a developer's
 * files were meant, and a dev-loop runner that quietly uploaded whatever
 * appeared beside your source would be the worse failure. Producing outputs
 * needs a declared output directory the model is told about and a size policy
 * for what is too big to carry in-band; `readFile` below is the bounded
 * read-back, for a caller that names the file. A runner that has all three
 * fills the field, and `codeRunnerTool` mints every data-carrying entry with
 * no further wiring.
 *
 * ── Files and commands ─────────────────────────────────────────────────────
 * `readFile(path, { maxBytes })` reads ONE file back from the working
 * directory — the path checked by the port's one rule (`sandboxPath`), then
 * by its REAL location, so a symbolic link cannot lead it outside; a file over
 * `maxBytes` is refused, never cut; a file on disk is bytes, so bytes come
 * back and no encoding is guessed. `runCommand(command)` runs ONE `sh -c`
 * command with the same environment allowlist as the code, and exists only on
 * a runner built with `commands: true`. Neither is a network or filesystem
 * jail: a command reaches whatever this machine reaches.
 *
 * So: a development loop, a trusted-input pipeline, a machine you would be
 * relaxed about a shell script running on. NOT arbitrary model-written code
 * from an untrusted user, on a host with anything on it. For that, run a real
 * sandbox behind the same port — `agentCoreCodeRunner`, a gVisor container, a
 * Firecracker VM — and keep the tool identical.
 *
 * **In-process `eval` / `node:vm` is refused outright.** Node's own
 * documentation says `vm` is not a security mechanism ("do not use it to run
 * untrusted code"), so shipping it as one would be theater: the same code
 * reaching the same globals, wearing a word that makes a reader stop checking.
 * A subprocess is genuinely a boundary; it is just a smaller one than the word
 * "sandbox" implies. The library teaches refusals for things that are WRONG and
 * honest names for things that are merely LIMITED — running local code in a dev
 * loop is not wrong, and calling it a sandbox is.
 *
 * @example
 *   const agent = Agent.create({ provider })
 *     .tool(codeRunnerTool({ runner: localCodeRunner() }))
 *     .build();
 */

import type {
  CodeCommandOptions,
  CodeCommandResult,
  CodeFile,
  CodeInput,
  CodeReadOptions,
  CodeResult,
  CodeRunner,
  CodeSession,
  StagedCodeInput,
} from '../../provider-contract/types.js';
import { STAGED_INPUTS_ENV } from '../../provider-contract/types.js';
import { CodeSandboxError, readBound, sandboxPath } from '../../provider-contract/codeSandbox.js';
import { abortErrorOf, armDeadline, linkedController, throwIfAborted } from '../../lib/abort.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { safeFileName } from './fileName.js';
import { boundOutput, commandBounds, commandResult, payloadBytes } from './output.js';

export interface LocalCodeRunnerOptions {
  /**
   * How to run a snippet, as `[command, ...args]` — the code is appended as the
   * final argument. Defaults by language: `['node', '-e']` for javascript,
   * `['python3', '-c']` for python.
   */
  readonly command?: readonly string[];
  /** Working directory for the child. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /**
   * The child's environment. An ALLOWLIST, never a merge: `process.env` is NOT
   * inherited, so a credential sitting in this process's environment is not
   * handed to model-written code by default. Pass exactly what the code needs.
   *
   * ONE exception, stated because an unstated one is a hole: `PATH` is passed
   * through, because without it the operating system cannot find the
   * interpreter and nothing runs at all. `PATH` names directories, not secrets.
   * Set `env: { PATH: '/usr/bin' }` to narrow it, or `env: { PATH: '' }` to
   * refuse even that — anything you supply here WINS over the inherited value.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Per-execution ceiling; the child is killed past it. Default 30s. */
  readonly timeoutMs?: number;
  /**
   * Per-stream output ceiling, in characters. Default 8000.
   *
   * Cutting is allowed; cutting SILENTLY is not — anything cut is reported on
   * `CodeResult.truncated`, and `codeRunnerTool` renders that as a visible
   * marker in the tool result. The model has to know the table it is about to
   * reason over is a fragment.
   */
  readonly maxOutputChars?: number;
  /**
   * Give each session `runCommand` — one `sh -c` command in the working
   * directory, with the same environment allowlist as the code. Default
   * `false`, and then the member is ABSENT (`canRunCodeCommands` says no):
   * it runs arbitrary shell, so a runner offers it only when built to. Build
   * one runner per agent that should have it.
   *
   * Not a jail: the command reaches this machine's filesystem and network, as
   * the code already does.
   */
  readonly commands?: boolean;
  /** Stable id (default `'local-code-runner'`). Rides the session events. */
  readonly id?: string;
  /** @internal Test seam — the `node:child_process` module. */
  readonly _childProcess?: ChildProcessModuleLike;
  /** @internal Test seam — the `node:fs` slice staging and reading use. */
  readonly _fs?: FsModuleLike;
  /** @internal Test seam — where staging directories are created. Defaults to
   *  the OS temp directory. */
  readonly _stagingRoot?: string;
}

/** The slice of `node:fs` staging and reading touch. Loaded lazily, and ONLY
 *  when a caller actually stages or reads something — a session that does
 *  neither never asks this runtime for a filesystem. */
export interface FsModuleLike {
  readonly mkdtempSync?: (prefix: string) => string;
  readonly writeFileSync?: (path: string, data: string | Uint8Array) => void;
  readonly rmSync?: (path: string, options?: { recursive?: boolean; force?: boolean }) => void;
  readonly realpathSync?: (path: string) => string;
  readonly openSync?: (path: string, flags: string | number) => number;
  /** The open flags a read uses where the platform has them. */
  readonly constants?: {
    readonly O_RDONLY?: number;
    readonly O_NONBLOCK?: number;
    readonly O_NOFOLLOW?: number;
  };
  readonly fstatSync?: (fd: number) => { isFile(): boolean; readonly size: number };
  readonly readSync?: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ) => number;
  readonly closeSync?: (fd: number) => void;
}

/** The slice of `node:child_process` this adapter touches. */
export interface ChildProcessModuleLike {
  /** Used when present (the real module always has it): only `spawn` can give
   *  a child a process group of its own. */
  readonly spawn?: SpawnLike;
  readonly execFile?: (
    file: string,
    args: readonly string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      maxBuffer?: number;
      killSignal?: string;
      detached?: boolean;
    },
    callback: (
      error: (Error & { code?: number | string; killed?: boolean; signal?: string | null }) | null,
      stdout: string,
      stderr: string,
    ) => void,
  ) => unknown;
}

/** The part of the child `execFile` / `spawn` hands back that ending it needs. */
interface ChildLike {
  readonly pid?: number;
  kill?(signal?: string): boolean;
  readonly stdout?: { destroy?(): void } | null;
  readonly stderr?: { destroy?(): void } | null;
}

/** A readable end of a spawned child's pipe, as far as collecting it goes. */
interface PipeLike {
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
  destroy?(): void;
}

/** The child `spawn` hands back, as far as this adapter uses it. */
interface SpawnedLike extends ChildLike {
  readonly stdout?: PipeLike | null;
  readonly stderr?: PipeLike | null;
  on(event: 'error', listener: (error: Error & { code?: string }) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
}

/** The slice of `node:child_process` · `spawn` the runner uses — preferred
 *  over `execFile`, which does not pass `detached` on to the child. */
type SpawnLike = (
  file: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    detached?: boolean;
    stdio?: readonly ['ignore', 'pipe', 'pipe'];
  },
) => SpawnedLike;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 8_000;

/** How each supported language is invoked when no `command` was given. */
const DEFAULT_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  javascript: ['node', '-e'],
  js: ['node', '-e'],
  node: ['node', '-e'],
  typescript: ['npx', 'tsx', '-e'],
  ts: ['npx', 'tsx', '-e'],
  python: ['python3', '-c'],
  python3: ['python3', '-c'],
  py: ['python3', '-c'],
};

export function localCodeRunner(options: LocalCodeRunnerOptions = {}): CodeRunner {
  const id = options.id ?? 'local-code-runner';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  return {
    id,
    start(req): Promise<CodeSession> {
      // A local session is a NAME and a working directory, not a live handle:
      // each execution is its own process. Saying so matters — a consumer who
      // assumed variables carry between calls (they do on AgentCore, whose
      // session is a live kernel) would silently get different semantics.
      // `codeRunnerTool` states this in the tool description it hands the model.
      const sessionId = `local:${req.key}`;
      let stopped = false;
      /** The session's staging directory, created on the FIRST `stageInputs`
       *  and released by `stop()`. Absent until then, which is what keeps a
       *  session that never stages byte-identical to every earlier release —
       *  no directory, no environment variable, no filesystem module loaded. */
      let stagingDir: string | undefined;
      /** name → path, exactly as the manifest carries it. */
      const staged = new Map<string, string>();
      /** The child's environment, for code and commands alike. */
      const childEnv = (): Record<string, string> => ({
        // ALLOWLIST. `process.env` is deliberately NOT spread in — only
        // PATH, so the OS can find the interpreter, and it is overridable.
        PATH: process.env.PATH ?? '',
        ...(options.env ?? {}),
        // The staged-input manifest joins it LAST and is not overridable:
        // it is not configuration, it is a fact about this execution, and
        // an operator `env` that happened to define the same name would
        // otherwise hand the model paths to files that are not there.
        // Absent entirely when nothing was staged.
        ...(staged.size > 0 && {
          [STAGED_INPUTS_ENV]: JSON.stringify(Object.fromEntries(staged)),
        }),
      });
      const refuseIfStopped = (toDo: string): void => {
        if (stopped) {
          throw new Error(
            `localCodeRunner: session ${sessionId} was stopped; open a new one to ${toDo}.`,
          );
        }
      };
      const session: CodeSession = {
        id: sessionId,
        async execute(exec): Promise<CodeResult> {
          refuseIfStopped('run more code');
          const language = exec.language ?? req.language ?? 'javascript';
          const command = options.command ?? DEFAULT_COMMANDS[language.toLowerCase()];
          if (!command || command.length === 0) {
            throw new Error(
              `localCodeRunner: no command for language '${language}'. ` +
                `Known: ${Object.keys(DEFAULT_COMMANDS).join(', ')}. ` +
                "Pass `command: ['your-interpreter', '-c']` for anything else.",
            );
          }
          const [file, ...args] = command;
          const raw = await runChild(
            resolveChildProcess(options),
            file as string,
            [...args, exec.code],
            {
              cwd: options.cwd ?? process.cwd(),
              env: childEnv(),
              timeoutMs: exec.timeoutMs ?? timeoutMs,
              ...(exec.signal && { signal: exec.signal }),
            },
            {
              timedOut: (ms) =>
                new Error(
                  `localCodeRunner: the code did not finish within ${ms}ms and ${STOPPED}. ` +
                    'Raise `timeoutMs`, or have the code do less per call.',
                ),
              notRunnable: (code) =>
                new Error(
                  `localCodeRunner: could not run '${file as string}' (${code}). ` +
                    'Install the interpreter, or pass `command` pointing at one.',
                ),
            },
          );
          // The child's own streams only. The runtime's message for a failed
          // child ("Command failed: <the command line>") quotes the code, so
          // it is not passed off as the code's stderr.
          const bounded = boundOutput(raw.stdout, raw.stderr, maxOutputChars, raw.overflowed);
          return {
            // Known either way: an exit status, or a process that was ended
            // before it exited (no exit status at all — never a made-up one;
            // the signal that ended it, when known, says how).
            ok: raw.exitCode === 0,
            stdout: bounded.stdout,
            stderr: bounded.stderr,
            ...(raw.exitCode !== undefined && { exitCode: raw.exitCode }),
            ...(raw.signal !== undefined && { terminatedBy: raw.signal }),
            ...(bounded.truncated !== undefined && { truncated: bounded.truncated }),
          };
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async stageInputs(inputs: readonly CodeInput[]): Promise<readonly StagedCodeInput[]> {
          refuseIfStopped('stage inputs');
          const fs = resolveFs(options, 'staging inputs');
          const landed: StagedCodeInput[] = [];
          stagingDir ??= makeStagingDir(fs, options._stagingRoot);
          for (const input of inputs) {
            // The name is CALLER data landing in a filesystem, so it is
            // ENCODED into a single inert segment here rather than trusted: a
            // name of '../../etc/passwd' becomes a literal file name, two
            // distinct names never become one file, and the manifest still
            // keys it by what was asked for.
            const fileName = safeFileName(input.fileName ?? input.name);
            const path = `${stagingDir}/${fileName}`;
            const bytes = payloadBytes(input.data);
            writeFile(fs, path, input.data);
            staged.set(input.name, path);
            landed.push({ name: input.name, path, bytes });
          }
          return landed;
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async readFile(path: string, readOptions: CodeReadOptions): Promise<CodeFile> {
          refuseIfStopped('read files');
          const maxBytes = readBound(readOptions);
          throwIfAborted(readOptions.signal);
          const relative = sandboxPath(path);
          return readWithin(
            resolveFs(options, 'reading files'),
            options.cwd ?? process.cwd(),
            relative,
            maxBytes,
          );
        },
        ...(options.commands === true && {
          async runCommand(
            command: string,
            commandOptions?: CodeCommandOptions,
          ): Promise<CodeCommandResult> {
            refuseIfStopped('run commands');
            const bounds = commandBounds(command, commandOptions, maxOutputChars);
            const raw = await runChild(
              resolveChildProcess(options),
              'sh',
              ['-c', command],
              {
                cwd: options.cwd ?? process.cwd(),
                env: childEnv(),
                timeoutMs: bounds.timeoutMs ?? timeoutMs,
                ...(bounds.signal && { signal: bounds.signal }),
              },
              {
                timedOut: (ms) =>
                  new CodeSandboxError(
                    'timed-out',
                    `localCodeRunner: the command did not finish within ${ms}ms and ${STOPPED}.`,
                  ),
                notRunnable: (code) =>
                  new Error(
                    `localCodeRunner: could not run 'sh' (${code}); runCommand needs a POSIX ` +
                      'shell on PATH.',
                  ),
              },
            );
            // The child's own streams and exit status, nothing added: a
            // process the operating system ended has no exit status, and the
            // result says so by leaving it out.
            return commandResult(
              {
                stdout: raw.stdout,
                stderr: raw.stderr,
                ...(raw.exitCode !== undefined && { exitCode: raw.exitCode }),
                ...(raw.overflowed !== undefined && { overflowed: raw.overflowed }),
                ...(raw.signal !== undefined && { terminatedBy: raw.signal }),
              },
              bounds,
            );
          },
        }),
        stop(): Promise<void> {
          // Idempotent, and it refuses later executions rather than silently
          // starting a fresh process under a session the caller closed.
          stopped = true;
          // Staged inputs live as long as the session, and this is the end of
          // it. Failure is swallowed: a temp directory that could not be
          // removed is a tidiness problem, and turning it into a thrown
          // teardown would fail a turn that already succeeded.
          if (stagingDir !== undefined) {
            try {
              resolveFs(options, 'staging inputs').rmSync?.(stagingDir, {
                recursive: true,
                force: true,
              });
            } catch {
              // See above.
            }
            stagingDir = undefined;
            staged.clear();
          }
          return Promise.resolve();
        },
      };
      return Promise.resolve(session);
    },
  };
}

/** `node:fs`, or a refusal naming what `purpose` needs. Lazy for the same
 *  reason `node:child_process` is: a browser bundle that never stages or
 *  reads must not pay for a module it cannot have. */
function resolveFs(
  options: LocalCodeRunnerOptions,
  purpose: 'staging inputs' | 'reading files',
): FsModuleLike {
  if (options._fs) return options._fs;
  try {
    return lazyRequire<FsModuleLike>('node:fs');
  } catch {
    throw new Error(
      purpose === 'staging inputs'
        ? 'localCodeRunner: staging inputs needs `node:fs`, which this runtime does not provide ' +
          '(a browser bundle, or a restricted worker). Use a runner whose backend can write ' +
          'into its own session, or drop the tool’s `wants` declaration.'
        : 'localCodeRunner: reading files needs `node:fs`, which this runtime does not provide ' +
          '(a browser bundle, or a restricted worker); a runner whose backend reads its own ' +
          'session can.',
    );
  }
}

/** One private directory per session, under the OS temp root. */
function makeStagingDir(fs: FsModuleLike, root: string | undefined): string {
  const mkdtempSync = fs.mkdtempSync;
  if (typeof mkdtempSync !== 'function') {
    throw new Error('localCodeRunner: `node:fs` resolved but `mkdtempSync` is missing.');
  }
  const base = root ?? lazyRequire<{ tmpdir(): string }>('node:os').tmpdir();
  return mkdtempSync(`${base}/af-code-`);
}

function writeFile(fs: FsModuleLike, path: string, data: string | Uint8Array): void {
  const writeFileSync = fs.writeFileSync;
  if (typeof writeFileSync !== 'function') {
    throw new Error('localCodeRunner: `node:fs` resolved but `writeFileSync` is missing.');
  }
  writeFileSync(path, data);
}

/** How much of a file one `readSync` asks for. */
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Read ONE file under `root`, whole or not at all.
 *
 * `relative` has already passed the port's lexical rule; this adds the one
 * check only the caller's own machine can make — the file's REAL location,
 * after every symbolic link, must still be inside the real working directory.
 * (A sandbox has no such check to make: its whole disk is its own.) The check
 * and the open are two calls, not one atomic step; this is a development-loop
 * runner, and its module header says what it is not.
 *
 * Bounded twice: the size the file reports is checked before a byte is read,
 * and the read itself stops one chunk past `maxBytes` — a file that grew in
 * between is refused too, never handed back cut.
 */
function readWithin(fs: FsModuleLike, root: string, relative: string, maxBytes: number): CodeFile {
  const realpath = fsMember(fs, 'realpathSync');
  const open = fsMember(fs, 'openSync');
  const fstat = fsMember(fs, 'fstatSync');
  const read = fsMember(fs, 'readSync');
  const close = fsMember(fs, 'closeSync');
  let real: string;
  let realRoot: string;
  try {
    realRoot = realpath(root);
    real = realpath(`${root}/${relative}`);
  } catch (err) {
    throw notReturned(relative, errnoOf(err));
  }
  if (!isBelow(realRoot, real)) {
    throw new CodeSandboxError(
      'path-refused',
      `localCodeRunner: '${relative}' leads outside the working directory through a link, ` +
        'so it is not read.',
      { path: relative },
    );
  }
  let fd: number;
  try {
    fd = open(real, readFlags(fs));
  } catch (err) {
    throw notReturned(relative, errnoOf(err));
  }
  try {
    const stat = fstat(fd);
    if (!stat.isFile()) throw notReturned(relative, 'not a regular file');
    if (stat.size > maxBytes) throw tooLarge(relative, stat.size, maxBytes);
    const chunks: Uint8Array[] = [];
    const chunk = new Uint8Array(Math.min(READ_CHUNK_BYTES, maxBytes + 1));
    let total = 0;
    for (;;) {
      const n = read(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      total += n;
      if (total > maxBytes) throw tooLarge(relative, total, maxBytes);
      chunks.push(chunk.slice(0, n));
    }
    const data = new Uint8Array(total);
    let at = 0;
    for (const part of chunks) {
      data.set(part, at);
      at += part.byteLength;
    }
    return { path: relative, data, bytes: total };
  } finally {
    close(fd);
  }
}

/**
 * How a read opens its file: read-only, and — where the platform has the flags
 * — NON-BLOCKING, so a named pipe the session's code made cannot freeze this
 * process waiting for a writer (the `isFile` check after the open refuses it),
 * and NO-FOLLOW, so a link swapped in after the real-path check is not
 * followed. Plain `'r'` where the platform has neither.
 */
function readFlags(fs: FsModuleLike): string | number {
  const c = fs.constants;
  if (c?.O_NONBLOCK === undefined) return 'r';
  return (c.O_RDONLY ?? 0) | c.O_NONBLOCK | (c.O_NOFOLLOW ?? 0);
}

/**
 * Is `candidate` strictly below `root`? Both are real paths from the same
 * `realpathSync`, so they share one spelling of the root and one separator
 * style. String work rather than `node:path`, so reading files adds no Node
 * module to the browser-safe door's call-time graph.
 */
function isBelow(root: string, candidate: string): boolean {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const base = root.endsWith(separator) ? root : `${root}${separator}`;
  return candidate.startsWith(base) && candidate.length > base.length;
}

function fsMember<K extends keyof FsModuleLike>(
  fs: FsModuleLike,
  name: K,
): NonNullable<FsModuleLike[K]> {
  const member = fs[name];
  if (typeof member !== 'function') {
    throw new Error(`localCodeRunner: \`node:fs\` resolved but \`${name}\` is missing.`);
  }
  return member as NonNullable<FsModuleLike[K]>;
}

function errnoOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unreadable';
}

function notReturned(relative: string, why: string): CodeSandboxError {
  return new CodeSandboxError(
    'file-not-returned',
    `localCodeRunner: no file could be read at '${relative}' (${why}).`,
    { path: relative },
  );
}

function tooLarge(relative: string, bytes: number, maxBytes: number): CodeSandboxError {
  return new CodeSandboxError(
    'file-too-large',
    `localCodeRunner: '${relative}' is at least ${bytes} bytes and this read allows ` +
      `${maxBytes}. Nothing was returned — a file is never handed back cut. Raise \`maxBytes\`, ` +
      'or have the code write something smaller.',
    { path: relative, bytes, limit: maxBytes },
  );
}

function resolveChildProcess(options: LocalCodeRunnerOptions): ChildProcessModuleLike {
  if (options._childProcess) return options._childProcess;
  try {
    return lazyRequire<ChildProcessModuleLike>('node:child_process');
  } catch {
    throw new Error(
      'localCodeRunner needs `node:child_process`, which this runtime does not provide ' +
        '(a browser bundle, or a restricted worker). Use a remote runner — ' +
        '`agentCoreCodeRunner` — or supply your own `CodeRunner`.',
    );
  }
}

interface ChildOutcome {
  readonly stdout: string;
  readonly stderr: string;
  /** The child's exit status. Absent when it did not exit on its own — a
   *  signal ended it, from the operating system or from the runner at the
   *  output ceiling — and none is made up. */
  readonly exitCode?: number;
  /** The signal that ended the child before it exited, when known. */
  readonly signal?: string;
  /** The stream whose output passed the buffer ceiling. The child was ended
   *  there, and that stream's tail — and its full length — are lost. */
  readonly overflowed?: 'stdout' | 'stderr';
}

/** The two refusals whose words depend on what was run. */
interface ChildRefusals {
  /** The child outlived its ceiling and was ended. */
  readonly timedOut: (ms: number) => Error;
  /** The program itself could not be started (ENOENT and friends). */
  readonly notRunnable: (code: string) => Error;
}

/** How much one child's stdout or stderr may hold before it is ended. The CUT
 *  is the adapter's to make and report (`maxOutputChars`); this only bounds
 *  memory. */
const CHILD_BUFFER_BYTES = 32 * 1024 * 1024;

/** The runtime's code for an output that passed `maxBuffer`. */
const BUFFER_OVERFLOW = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

/**
 * Whether a child gets a process group of its own, so that the runner can stop
 * the group it owns. POSIX only: Windows has no process group to signal, and
 * there only the child itself can be stopped.
 */
const OWN_PROCESS_GROUP = process.platform !== 'win32';

/** What ending a child at its deadline did, in words that are true of it. */
const STOPPED = OWN_PROCESS_GROUP
  ? 'its process group was killed'
  : 'its process was stopped; work it started may still be running';

/**
 * Process groups this runner started and has not seen end. A group lives in
 * its own session, so a signal sent to the host's group — Ctrl-C in a
 * terminal — never reaches it. These are killed when the host exits.
 */
const liveGroups = new Set<number>();
let exitHookArmed = false;

function trackGroup(pid: number): void {
  liveGroups.add(pid);
  if (exitHookArmed) return;
  exitHookArmed = true;
  process.once('exit', () => {
    for (const group of liveGroups) killGroup(group);
  });
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone: nothing left to stop.
  }
}

/**
 * Stop a child's OWNED PROCESS GROUP, then release its pipes — every path on
 * which the runner ends a run goes through here: the deadline, an abort, the
 * output ceiling, an error after a start.
 *
 * Signalling only the direct child (the shell, or the interpreter) leaves its
 * own children running: a `sh -c` command that started a Node script would
 * keep writing files after the caller was told it had been killed. The group
 * goes, with SIGKILL, which none of its members can ignore, and the pipes are
 * closed so that nothing still holding them keeps the caller waiting.
 *
 * Cleanup, not containment: a descendant that starts a session or a group of
 * its own has left the owned group and is not stopped, and a host that is
 * killed without running its JavaScript exit handlers cannot stop anything.
 * This runner is not a sandbox (see the module header).
 */
function endChild(child: ChildLike | undefined): void {
  if (child === undefined) return;
  if (OWN_PROCESS_GROUP && typeof child.pid === 'number') {
    killGroup(child.pid);
    liveGroups.delete(child.pid);
  } else {
    try {
      child.kill?.('SIGKILL');
    } catch {
      // Already gone.
    }
  }
  try {
    child.stdout?.destroy?.();
    child.stderr?.destroy?.();
  } catch {
    // A stream the runtime already closed.
  }
}

/** The error a child that exited non-zero, or was ended by a signal, reports:
 *  the fields `execFile` carries, and a message that never quotes the
 *  command line (the runtime's own does — it is the code). */
function childFailure(
  code: number | null,
  signal: string | null,
): Error & { code?: number | string; killed?: boolean; signal?: string | null } {
  return Object.assign(new Error('the child process did not exit cleanly'), {
    ...(code !== null && { code }),
    signal,
    killed: signal !== null,
  });
}

/**
 * `execFile`'s callback contract, built on `spawn` — because only `spawn`
 * passes `detached` on, and a child in a process group of its own is what
 * lets the runner stop the group it owns. Same results: stdout and stderr as
 * text, a failure carrying the exit `code` or the `signal`, a spawn error
 * (ENOENT …) carrying its string code, and `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`
 * when a stream passes `maxBuffer` bytes, with what was collected up to the
 * ceiling. At that ceiling the owned group is stopped AT ONCE and the call
 * answered then (`endChild`), not when the pipes close. stdin is not
 * connected: nothing can block waiting for input that never comes.
 */
function execFileOn(spawn: SpawnLike): NonNullable<ChildProcessModuleLike['execFile']> {
  return (file, args, options, callback) => {
    const max = options.maxBuffer ?? CHILD_BUFFER_BYTES;
    const chunks = { stdout: [] as Uint8Array[], stderr: [] as Uint8Array[] };
    const sizes = { stdout: 0, stderr: 0 };
    let overflow: (Error & { code: string }) | undefined;
    let done = false;
    const text = (stream: 'stdout' | 'stderr'): string =>
      Buffer.concat(chunks[stream]).toString('utf8');
    const reply = (error: Parameters<typeof callback>[0]): void => {
      if (done) return;
      done = true;
      callback(error, text('stdout'), text('stderr'));
    };
    const child = spawn(file, args, {
      ...(options.cwd !== undefined && { cwd: options.cwd }),
      ...(options.env !== undefined && { env: options.env }),
      ...(options.detached === true && { detached: true }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collect = (stream: 'stdout' | 'stderr') => (chunk: Uint8Array) => {
      if (overflow !== undefined) return;
      const room = max - sizes[stream];
      if (chunk.byteLength > room) {
        chunks[stream].push(chunk.subarray(0, Math.max(room, 0)));
        sizes[stream] = max;
        overflow = Object.assign(new RangeError(`${stream} maxBuffer length exceeded`), {
          code: BUFFER_OVERFLOW,
        });
        // Stop the owned process GROUP here, and release the pipes, then
        // answer: waiting for `close` would wait for any descendant that
        // inherited the pipes — and it keeps working until it lets go.
        endChild(child);
        reply(overflow);
        return;
      }
      chunks[stream].push(chunk);
      sizes[stream] += chunk.byteLength;
    };
    child.stdout?.on('data', collect('stdout'));
    child.stderr?.on('data', collect('stderr'));
    child.on('error', (error) => reply(error));
    child.on('close', (code, signal) => {
      if (overflow !== undefined) reply(overflow);
      else if (code === 0 && signal === null) reply(null);
      else reply(childFailure(code, signal));
    });
    return child;
  };
}

/**
 * One child process, promisified.
 *
 * A NON-ZERO EXIT IS NOT A REJECTION. Code that fails is a normal answer here —
 * the model wrote it, it needs to read the traceback, and turning that into a
 * thrown tool error would replace the one thing that teaches the next attempt
 * with `error: true`. What DOES reject is the runner failing to run at all
 * (interpreter missing, timeout, abort), because that is not the code's answer.
 *
 * THE DEADLINE IS OURS (`lib/abort.ts`), not the runtime's `timeout`: that one
 * sends SIGTERM and then waits for the child to exit, so a child that ignored
 * SIGTERM ran on, and if it then exited 0 the call came back as a SUCCESS with
 * its output cut at the deadline. Here the deadline and the caller's signal
 * abort one controller; the child's owned PROCESS GROUP is killed with
 * SIGKILL (`endChild`), and the call rejects at once, whatever the child does
 * next.
 *
 * An abort rejects with the caller's own reason, never read as a missing
 * interpreter. So did an output past the buffer ceiling
 * (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`); that is now a result, its cut stated,
 * with no exit status and `signal: 'SIGKILL'`.
 *
 * Nothing of the runtime's own error text is passed on: for a failed child it
 * is "Command failed: <the whole command line>", which is the code itself.
 */
async function runChild(
  mod: ChildProcessModuleLike,
  file: string,
  args: readonly string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
  },
  refusals: ChildRefusals,
): Promise<ChildOutcome> {
  const execFile = typeof mod.spawn === 'function' ? execFileOn(mod.spawn.bind(mod)) : mod.execFile;
  if (typeof execFile !== 'function') {
    throw new Error('localCodeRunner: `node:child_process` resolved but `execFile` is missing.');
  }
  throwIfAborted(opts.signal);
  const { controller, unlink } = linkedController(opts.signal);
  const disarm = armDeadline(controller, opts.timeoutMs, () => refusals.timedOut(opts.timeoutMs));
  return new Promise<ChildOutcome>((resolve, reject) => {
    let child: ChildLike | undefined;
    let settled = false;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      disarm();
      unlink();
      controller.signal.removeEventListener('abort', onAbort);
      if (OWN_PROCESS_GROUP && typeof child?.pid === 'number') liveGroups.delete(child.pid);
      return true;
    };
    // The deadline, or the caller: stop the owned group and answer NOW. The
    // child's own callback, whenever it comes, finds the call settled.
    const onAbort = (): void => {
      endChild(child);
      if (settle()) reject(abortErrorOf(controller.signal));
    };
    try {
      child = execFile(
        file,
        args,
        {
          cwd: opts.cwd,
          env: opts.env,
          maxBuffer: CHILD_BUFFER_BYTES,
          killSignal: 'SIGKILL',
          ...(OWN_PROCESS_GROUP && { detached: true }),
        },
        (error, stdout, stderr) => {
          if (controller.signal.aborted) {
            onAbort();
            return;
          }
          if (!settle()) return;
          const out = String(stdout ?? '');
          const err = String(stderr ?? '');
          if (!error) {
            resolve({ stdout: out, stderr: err, exitCode: 0 });
            return;
          }
          if (error.code === BUFFER_OVERFLOW) {
            // On the `spawn` path the group was stopped where the overflow was
            // seen; this covers an injected `execFile`, which ends only the
            // direct child. A second stop of a stopped group is a no-op.
            endChild(child);
            resolve({
              stdout: out,
              stderr: err,
              signal: 'SIGKILL',
              overflowed: /^stderr/.test(error.message) ? 'stderr' : 'stdout',
            });
            return;
          }
          if (typeof error.code === 'string') {
            // ENOENT and friends — the interpreter itself is not here. Naming it
            // beats handing the model a traceback it cannot act on. A process
            // that did start before the error is stopped too, never left on.
            endChild(child);
            reject(refusals.notRunnable(error.code));
            return;
          }
          // A real non-zero exit, or a child the operating system ended: the
          // code ran and failed. That IS the result. The exit status is the
          // child's own, or absent — never a stand-in; the signal says how a
          // child without one was ended.
          resolve({
            stdout: out,
            stderr: err,
            ...(typeof error.code === 'number' && { exitCode: error.code }),
            ...(typeof error.signal === 'string' && { signal: error.signal }),
          });
        },
      ) as ChildLike | undefined;
    } catch (err) {
      if (settle()) reject(err);
      return;
    }
    if (OWN_PROCESS_GROUP && typeof child?.pid === 'number' && !settled) trackGroup(child.pid);
    if (controller.signal.aborted) onAbort();
    else if (!settled) controller.signal.addEventListener('abort', onAbort, { once: true });
  });
}
