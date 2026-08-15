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
 *   • kill on timeout, so runaway code has a ceiling;
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
 * needs three things this adapter does not have yet: a declared output
 * directory the model is told about, a bounded read-back of what landed in it,
 * and a size policy for what is too big to carry in-band. A runner that has
 * them (a managed sandbox that returns file contents) fills the field, and
 * `codeRunnerTool` mints every data-carrying entry with no further wiring.
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

import type { CodeInput, CodeResult, CodeRunner, CodeSession, StagedCodeInput } from '../types.js';
import { STAGED_INPUTS_ENV } from '../types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';

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
  /** Stable id (default `'local-code-runner'`). Rides the session events. */
  readonly id?: string;
  /** @internal Test seam — the `node:child_process` module. */
  readonly _childProcess?: ChildProcessModuleLike;
  /** @internal Test seam — the `node:fs` slice staging uses. */
  readonly _fs?: FsModuleLike;
  /** @internal Test seam — where staging directories are created. Defaults to
   *  the OS temp directory. */
  readonly _stagingRoot?: string;
}

/** The slice of `node:fs` staging touches. Loaded lazily, and ONLY when a
 *  caller actually stages something — a session that never stages never asks
 *  this runtime for a filesystem. */
export interface FsModuleLike {
  readonly mkdtempSync?: (prefix: string) => string;
  readonly writeFileSync?: (path: string, data: string | Uint8Array) => void;
  readonly rmSync?: (path: string, options?: { recursive?: boolean; force?: boolean }) => void;
}

/** The slice of `node:child_process` this adapter touches. */
export interface ChildProcessModuleLike {
  readonly execFile?: (
    file: string,
    args: readonly string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
      maxBuffer?: number;
      signal?: AbortSignal;
    },
    callback: (
      error: (Error & { code?: number | string; killed?: boolean }) | null,
      stdout: string,
      stderr: string,
    ) => void,
  ) => unknown;
}

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
      return Promise.resolve({
        id: sessionId,
        async execute(exec): Promise<CodeResult> {
          if (stopped) {
            throw new Error(
              `localCodeRunner: session ${sessionId} was stopped; open a new one to run more code.`,
            );
          }
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
              // ALLOWLIST. `process.env` is deliberately NOT spread in — only
              // PATH, so the OS can find the interpreter, and it is overridable.
              //
              // The staged-input manifest joins it LAST and is not overridable:
              // it is not configuration, it is a fact about this execution, and
              // an operator `env` that happened to define the same name would
              // otherwise hand the model paths to files that are not there.
              // Absent entirely when nothing was staged.
              env: {
                PATH: process.env.PATH ?? '',
                ...(options.env ?? {}),
                ...(staged.size > 0 && {
                  [STAGED_INPUTS_ENV]: JSON.stringify(Object.fromEntries(staged)),
                }),
              },
              timeoutMs: exec.timeoutMs ?? timeoutMs,
              ...(exec.signal && { signal: exec.signal }),
            },
          );
          const stdout = cut(raw.stdout, maxOutputChars);
          const stderr = cut(raw.stderr, maxOutputChars);
          const truncated = {
            ...(stdout.cut && { stdout: true }),
            ...(stderr.cut && { stderr: true }),
            ...((stdout.cut || stderr.cut) && {
              ofChars: Math.max(raw.stdout.length, raw.stderr.length),
            }),
          };
          return {
            ok: raw.exitCode === 0,
            stdout: stdout.text,
            stderr: stderr.text,
            ...(raw.exitCode !== undefined && { exitCode: raw.exitCode }),
            // Present IFF something was actually cut — an empty object here
            // would read as "truncation happened, magnitude unknown".
            ...(Object.keys(truncated).length > 0 && { truncated }),
          };
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async stageInputs(inputs: readonly CodeInput[]): Promise<readonly StagedCodeInput[]> {
          if (stopped) {
            throw new Error(
              `localCodeRunner: session ${sessionId} was stopped; open a new one to stage inputs.`,
            );
          }
          const fs = resolveFs(options);
          const landed: StagedCodeInput[] = [];
          stagingDir ??= makeStagingDir(fs, options._stagingRoot);
          for (const input of inputs) {
            // The name is CALLER data landing in a filesystem, so it is
            // reduced to a single inert segment here rather than trusted: a
            // name of '../../etc/passwd' becomes a literal file name, and the
            // manifest still keys it by what was asked for.
            const fileName = safeFileName(input.fileName ?? input.name);
            const path = `${stagingDir}/${fileName}`;
            const bytes =
              typeof input.data === 'string'
                ? Buffer.byteLength(input.data, 'utf8')
                : input.data.byteLength;
            writeFile(fs, path, input.data);
            staged.set(input.name, path);
            landed.push({ name: input.name, path, bytes });
          }
          return landed;
        },
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
              resolveFs(options).rmSync?.(stagingDir, { recursive: true, force: true });
            } catch {
              // See above.
            }
            stagingDir = undefined;
            staged.clear();
          }
          return Promise.resolve();
        },
      });
    },
  };
}

/** `node:fs`, or a refusal naming what staging needs. Lazy for the same reason
 *  `node:child_process` is: a browser bundle that never stages must not pay
 *  for a module it cannot have. */
function resolveFs(options: LocalCodeRunnerOptions): FsModuleLike {
  if (options._fs) return options._fs;
  try {
    return lazyRequire<FsModuleLike>('node:fs');
  } catch {
    throw new Error(
      'localCodeRunner: staging inputs needs `node:fs`, which this runtime does not provide ' +
        '(a browser bundle, or a restricted worker). Use a runner whose backend can write ' +
        'into its own session, or drop the tool’s `wants` declaration.',
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

/**
 * One caller-supplied name → one inert file-name segment.
 *
 * Separators and dots are replaced rather than stripped, so `..` cannot
 * survive as a parent hop and `a/b` cannot become two segments — the same law
 * `artifacts/scopePath` states for scope tuples, applied to the one other
 * place caller strings become file names in this package.
 */
function safeFileName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '_');
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'input';
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
  readonly exitCode?: number;
}

/**
 * One child process, promisified.
 *
 * A NON-ZERO EXIT IS NOT A REJECTION. Code that fails is a normal answer here —
 * the model wrote it, it needs to read the traceback, and turning that into a
 * thrown tool error would replace the one thing that teaches the next attempt
 * with `error: true`. What DOES reject is the runner failing to run at all
 * (interpreter missing, timeout, abort), because that is not the code's answer.
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
): Promise<ChildOutcome> {
  const execFile = mod.execFile;
  if (typeof execFile !== 'function') {
    throw new Error('localCodeRunner: `node:child_process` resolved but `execFile` is missing.');
  }
  return new Promise<ChildOutcome>((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs,
        // Generous, because the CUT is ours to make and to report — letting the
        // runtime's own buffer overflow would surface as an error whose message
        // says nothing about how much was lost.
        maxBuffer: 32 * 1024 * 1024,
        ...(opts.signal && { signal: opts.signal }),
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), exitCode: 0 });
          return;
        }
        if (error.killed === true) {
          reject(
            new Error(
              `localCodeRunner: the code did not finish within ${opts.timeoutMs}ms and the ` +
                'process was killed. Raise `timeoutMs`, or have the code do less per call.',
            ),
          );
          return;
        }
        if (typeof error.code === 'string') {
          // ENOENT and friends — the interpreter itself is not here. Naming it
          // beats handing the model a traceback it cannot act on.
          reject(
            new Error(
              `localCodeRunner: could not run '${file}' (${error.code}). ` +
                'Install the interpreter, or pass `command` pointing at one.',
            ),
          );
          return;
        }
        // A real non-zero exit: the code ran and failed. That IS the result.
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '') || error.message,
          exitCode: typeof error.code === 'number' ? error.code : 1,
        });
      },
    );
  });
}

/** Cut to `max` characters, saying whether it cut. */
function cut(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  return { text: text.slice(0, max), cut: true };
}
