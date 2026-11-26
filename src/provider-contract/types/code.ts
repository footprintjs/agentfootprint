// ─── Code Runner (9.7.0) ────────────────────────────────────────────

/**
 * A service that runs code in an isolated session — a managed code
 * interpreter, a container pool, a subprocess.
 *
 * **The shape is Start → Execute ×N → Stop**, because that is what every real
 * one is, and the middle is the part a framework has to make possible. Paying
 * session start-up on every call is the honest cheap version; holding the
 * session in a module-level map is the fast version that hands one live sandbox
 * to whoever calls next. `ctx.onTeardown` + {@link ToolExecutionContext.runId}
 * are what let a tool do neither.
 *
 * ── Why this port exists at all: "summarize prose, compute data" ────────────
 * A tool that returns 40MB of rows does not need a bigger context window; it
 * needs to not put the rows in one. The motivating failure is a real production
 * request of 879,073 tokens — a tool result pasted straight into the prompt.
 * With a code runner, the model writes the aggregation, the RUNNER holds the
 * data, and what comes back is the answer. Prose gets summarized; data gets
 * computed. `CodeResult.truncated` exists so the second half of that promise
 * cannot quietly break.
 *
 * Implement it for your own backend; ship it to `codeRunnerTool({ runner })`.
 */
/** One screenshot a browser session took. */
export interface BrowserShot {
  /** Image bytes. */
  readonly data: Uint8Array;
  /** Image format, lower-case (`'png'`). */
  readonly format: string;
}

/** Who is driving a browser session right now. */
export type BrowserDriver = 'agent' | 'person';

/**
 * A browser an agent can drive — the PORT (9.68.0).
 *
 * Deliberately small, and deliberately not a browser automation API. Page-level
 * work (navigate, find an element, fill a form) is what CDP and Playwright
 * already do far better than any interface here would; a session exposes
 * {@link BrowserSession.automationEndpoint} so those attach directly. What this
 * port carries is what an automation library CANNOT do on its own: open and
 * release a managed session, reach the operating system above the page, and —
 * the one that matters — hand the controls to a person and take them back.
 */
export interface BrowserRunner {
  /** Stable id — reported on every tool-session event, so a row names its backend. */
  readonly id: string;
  /**
   * Open a session.
   *
   * `key` is the ISOLATION key the caller derived. An adapter may use it to
   * name the remote session; it must never widen it.
   */
  start(req: { readonly key: string; readonly signal?: AbortSignal }): Promise<BrowserSession>;
}

/** One open browser session. */
export interface BrowserSession {
  /** The backend's own id for this session. */
  readonly id: string;
  /**
   * Where an automation client attaches — a CDP WebSocket, for Playwright and
   * friends. Absent on a backend that offers no such channel.
   *
   * This library does not drive the page for you and does not depend on
   * Playwright; it hands you the endpoint and stays out of the way.
   */
  readonly automationEndpoint?: string;
  /** Where a PERSON can watch this session, when the backend offers a view. */
  readonly liveViewEndpoint?: string;
  /** Click at a point, in the operating system rather than in the page. */
  click(req: {
    readonly x: number;
    readonly y: number;
    readonly button?: 'left' | 'middle' | 'right';
    readonly clicks?: number;
  }): Promise<void>;
  /** Type text, as a keyboard would. */
  type(text: string): Promise<void>;
  /** Press a named key, optionally more than once. */
  press(req: { readonly key: string; readonly times?: number }): Promise<void>;
  /** Take a screenshot of the session as it is now. */
  screenshot(): Promise<BrowserShot>;
  /**
   * Hand the controls to a person, or take them back (optional).
   *
   * This is the seam a human-in-the-loop browsing flow is built on: the agent
   * stops driving, a person finishes the step that needed them — a login, a
   * consent screen, a CAPTCHA — and the agent resumes on the page they left.
   * Absent on a backend with no such notion; feature-detect before offering it.
   */
  handControlTo?(driver: BrowserDriver): Promise<void>;
  /**
   * Release the session.
   *
   * Must tolerate a session the far side already reaped — an idle timeout is
   * the reality on every managed backend, and a stop on a dead session is a
   * no-op, not an error.
   */
  stop(): Promise<void>;
}

export interface CodeRunner {
  /** Stable id — reported on every `agentfootprint.tools.session_*` event so a
   *  row names its backend, not just its tool. */
  readonly id: string;
  /**
   * Open a session.
   *
   * `key` is the ISOLATION key the caller derived (see `toolSessionKey`). An
   * adapter may use it to name the remote session; it must never widen it.
   */
  start(req: {
    readonly key: string;
    readonly language?: string;
    readonly signal?: AbortSignal;
  }): Promise<CodeSession>;
}

/**
 * The environment variable an executing snippet reads its staged inputs from —
 * a JSON object mapping each input's NAME to the path it landed at.
 *
 * Part of {@link CodeSession.stageInputs}'s contract rather than one adapter's
 * convention, and named here so an adapter uses the constant instead of
 * retyping the string. It is what makes model-written code portable across
 * backends: the code reads one variable, and every adapter that stages inputs
 * fills it the same way.
 */
export const STAGED_INPUTS_ENV = 'AF_STAGED_INPUTS';

/**
 * One payload staged INTO a code session before code runs (9.26.0).
 *
 * `name` is the file name the caller wants it under — the tool derives it from
 * the declared argument (`dataset` → `dataset.json`), so the model can be told
 * the name in a static description. An adapter may sanitize it (a name is
 * caller data landing in a filesystem) but must not rename it beyond
 * recognition, because the manifest is keyed by what it was ASKED for.
 */
export interface CodeInput {
  /**
   * The MANIFEST KEY — what the executing code looks this input up by. The
   * tool uses the declared argument name (`dataset`), so a static description
   * can tell the model exactly what to look up before any session exists.
   */
  readonly name: string;
  /**
   * The file name to write it under, when it should differ from `name` — the
   * tool derives one from the artifact's media type (`dataset` +
   * `application/json` → `dataset.json`) so an interpreter's own loader sees a
   * familiar extension. Defaults to `name`.
   *
   * A separate field precisely so the manifest KEY and the on-disk NAME cannot
   * drift: the code looks up what it was told to look up, whatever the file
   * ended up being called.
   */
  readonly fileName?: string;
  /** The bytes. A string is written as UTF-8 text; a `Uint8Array` verbatim. */
  readonly data: string | Uint8Array;
  /** The producer's own statement about the payload, when it has one. */
  readonly mediaType?: string;
}

/** Where one staged input actually landed. */
export interface StagedCodeInput {
  /** The name it was asked for — the manifest key the code looks up. */
  readonly name: string;
  /** The path the executing code opens. Absolute, or relative to the session's
   *  working directory: whichever it is, it is what the manifest carries and
   *  what the code should use verbatim. */
  readonly path: string;
  /** How many bytes landed. */
  readonly bytes: number;
}

/** One live session. `stop()` is idempotent and tolerates "already gone". */
export interface CodeSession {
  /** The backend's own id for this session, when it has one. */
  readonly id: string;
  execute(req: {
    readonly code: string;
    readonly language?: string;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<CodeResult>;
  /**
   * OPTIONAL (9.26.0) — put payloads INTO the session, so code can read data
   * that never travelled through the context window.
   *
   * ── Why it is a new member rather than an argument to `execute` ──────────
   * The port's only input was the code STRING, and 9.22.0 stated the honest
   * consequence rather than working around it: pushing a resolved artifact
   * through that door would mean inlining megabytes into an argv, in
   * language-specific quoting, past operating-system argument limits. This is
   * the session file-write verb that note said it was waiting for.
   *
   * ── The contract, which is two promises not one ─────────────────────────
   *  1. The payloads are written where the session's code can read them, and
   *     the returned {@link StagedCodeInput.path} is what the code opens.
   *  2. Every later `execute` on this session exposes the manifest as the
   *     {@link STAGED_INPUTS_ENV} environment variable — a JSON object of
   *     `name → path`. That second promise is what makes the model's code
   *     portable: it reads one variable, on every backend that stages.
   *
   * Staged inputs live as long as the SESSION and are released by `stop()`.
   *
   * ── Absent, never faked ─────────────────────────────────────────────────
   * A backend that cannot write into its own session LEAVES THIS ABSENT.
   * Feature-detect with `canStageCodeInputs(session)`; `codeRunnerTool`
   * refuses by name when a tool declares artifact inputs and the runner cannot
   * carry them, because running the code without the data it declared would be
   * the accepted-and-silently-wrong failure.
   */
  stageInputs?(inputs: readonly CodeInput[]): Promise<readonly StagedCodeInput[]>;
  /**
   * OPTIONAL — read ONE file back out of the session, whole or not at all.
   *
   * `path` is relative to the session's working directory and may not leave
   * it. An absolute path, a `..` that climbs above the working directory, a
   * backslash, a leading `~` or a NUL is refused by name before anything is
   * sent (`CodeSandboxError`, reason `'path-refused'`) — one rule,
   * `sandboxPath`, shared by every adapter.
   *
   * The answer is the file the BACKEND returned for that path, paired to it
   * by what the backend said it returned. A file the adapter cannot pair with
   * the path it asked for is refused, never guessed at — a backend that
   * answers with another file, or with two, has not answered this read.
   *
   * `maxBytes` is required: a read names its bound. A file over it is refused
   * (reason `'file-too-large'`), never cut — a truncated file handed back as
   * the file is the silent success this port refuses everywhere else.
   *
   * Feature-detect with `canReadCodeFiles(session)`.
   */
  readFile?(path: string, options: CodeReadOptions): Promise<CodeFile>;
  /**
   * OPTIONAL — run ONE shell command in the session.
   *
   * It runs arbitrary shell, so an adapter offers it only when the runner was
   * built with `commands: true`; otherwise the member is ABSENT. Feature-detect
   * with `canRunCodeCommands(session)`. The command runs in the session's
   * working directory with the environment `execute` gets, staged-input
   * manifest included.
   *
   * The result says only what the backend reported. The exit status comes
   * from the backend or not at all: when it reported none, `exitCode` is
   * absent — unknown, never inferred from an error flag and never defaulted.
   * stdout and stderr are bounded, and a cut is stated on `truncated`.
   */
  runCommand?(command: string, options?: CodeCommandOptions): Promise<CodeCommandResult>;
  /**
   * Release the session.
   *
   * Must tolerate a session the far side already reaped — an idle timeout is
   * the reality on every managed backend, and a `Stop` on a dead session is a
   * no-op, not an error.
   */
  stop(): Promise<void>;
}

/** Can this session accept staged inputs? The feature-detection law: read the
 *  member, never assume it from the adapter's name. */
export function canStageCodeInputs(
  session: CodeSession,
): session is CodeSession & Required<Pick<CodeSession, 'stageInputs'>> {
  return typeof session.stageInputs === 'function';
}

/** Can this session read files back out? Read the member, never the adapter's name. */
export function canReadCodeFiles(
  session: CodeSession,
): session is CodeSession & Required<Pick<CodeSession, 'readFile'>> {
  return typeof session.readFile === 'function';
}

/** Can this session run shell commands? Absent unless the runner was built
 *  with `commands: true`. Read the member, never the adapter's name. */
export function canRunCodeCommands(
  session: CodeSession,
): session is CodeSession & Required<Pick<CodeSession, 'runCommand'>> {
  return typeof session.runCommand === 'function';
}

/** How one {@link CodeSession.readFile} is bounded. */
export interface CodeReadOptions {
  /**
   * The most bytes this read may return. Required, and a positive whole
   * number: a file larger than this is refused, never cut.
   */
  readonly maxBytes: number;
  /** Stop waiting for the read. */
  readonly signal?: AbortSignal;
}

/** One file read back out of a code session — exactly as the backend returned it. */
export interface CodeFile {
  /** The path that was read, in the canonical form the backend was asked for
   *  (`./out//a.csv` → `out/a.csv`). */
  readonly path: string;
  /**
   * The contents. A string when the backend returned TEXT, bytes when it
   * returned BYTES — decided by which of the two the backend filled, never by
   * the file's name or extension. A backend that draws no such line
   * (`localCodeRunner`: a file on disk is bytes) returns bytes, and never
   * guesses an encoding.
   */
  readonly data: string | Uint8Array;
  /** The size of `data` in bytes (a string's UTF-8 length). */
  readonly bytes: number;
  /** The backend's own statement of the media type, when it made one. Never guessed. */
  readonly mediaType?: string;
}

/** How one {@link CodeSession.runCommand} is bounded. */
export interface CodeCommandOptions {
  /**
   * Stop waiting after this many milliseconds. What happens to the command
   * depends on the backend, and the error says which: a local child process is
   * killed; a managed sandbox may keep running it.
   */
  readonly timeoutMs?: number;
  /** Stop waiting when this fires. */
  readonly signal?: AbortSignal;
  /** Per-stream ceiling for this command's output, in characters. The
   *  runner's own `maxOutputChars` when absent. A cut is stated on `truncated`. */
  readonly maxOutputChars?: number;
  /**
   * A line the command prints when it reaches a point you care about — for
   * example `make && echo STEP_DONE` with `checkpoint: 'STEP_DONE'`. The
   * result then says, on `checkpointSeen`, whether stdout held that exact line,
   * read BEFORE any cut, so a marker printed past `maxOutputChars` is still
   * found.
   *
   * It proves the command reached that line and nothing more: not that it
   * exited cleanly, and not that anything after it ran. Its absence proves
   * nothing about why. One line, no line breaks.
   */
  readonly checkpoint?: string;
}

/** What one shell command produced — only what the backend reported. */
export interface CodeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  /**
   * The exit status the backend reported. ABSENT when it reported none: the
   * outcome is unknown. Never inferred from {@link CodeCommandResult.isError},
   * never defaulted, never derived from the output.
   */
  readonly exitCode?: number;
  /**
   * The backend's own error flag, as it reported it (AgentCore's `isError`);
   * absent when it reported none. It is NOT an exit status — a command can
   * fail without it, and it can be set with no exit status at all.
   */
  readonly isError?: boolean;
  /** The signal that ended the command before it exited, when the runner knows
   *  it (`'SIGKILL'`). There is no `exitCode` then, and none is made up. */
  readonly terminatedBy?: string;
  /** Present IFF output was cut — see {@link CodeTruncation}. */
  readonly truncated?: CodeTruncation;
  /** Present IFF a `checkpoint` was asked for: whether stdout held that line. */
  readonly checkpointSeen?: boolean;
}

/**
 * Present IFF output was cut, and then it says by how much.
 *
 * Load-bearing, not politeness. A runner exists so big data is computed
 * outside the context window instead of pasted into it; a runner that
 * quietly slices its own output to fit is the same bug wearing a different
 * hat, and the model would go on to reason over a truncated table it was
 * never told was truncated. An unstated slice is a silent success.
 */
export interface CodeTruncation {
  readonly stdout?: boolean;
  readonly stderr?: boolean;
  /** The pre-truncation length, in characters, of whichever stream was cut. */
  readonly ofChars?: number;
}

/** What one execution produced. */
export interface CodeResult {
  /**
   * Did the code run to completion without an error exit? WHAT THE RUNNER
   * REPORTED, nothing more.
   *
   * `true` or `false` only when the backend said so: an exit status, or its
   * own error verdict. ABSENT when it reported neither — the outcome is
   * unknown, and an absent `ok` is never success. (Before this was optional,
   * `agentCoreCodeRunner` filled `true` from silence.) A `false` is told
   * apart by the fields below: a program that exited non-zero (`exitCode`), a
   * backend error with no exit status (`serviceError`, where the run is
   * unconfirmed), and a process ended before it exited (`terminatedBy`).
   */
  readonly ok?: boolean;
  readonly stdout: string;
  readonly stderr: string;
  /** The exit status — exactly when the runner reported one. Never inferred
   *  from an error flag, never defaulted. */
  readonly exitCode?: number;
  /**
   * `true` when the backend flagged its answer as an error and reported NO
   * exit status: whether the code ran at all is not confirmed. That is not a
   * program that failed — a program that ran and failed has an `exitCode`.
   * `ok` is `false` alongside it.
   */
  readonly serviceError?: true;
  /**
   * The signal that ended the process before it exited, when the runner knows
   * it (`'SIGKILL'`): there is no exit status then, and none is made up. A
   * local child the operating system ended, or one the runner ended because
   * its output passed the buffer ceiling. `ok` is `false` alongside it.
   */
  readonly terminatedBy?: string;
  /** Files the run produced, described rather than inlined — the whole point is
   *  that big data does not enter the window. All fields beyond the original
   *  `{ name, bytes, uri? }` are ADDITIVE (9.22.0) and honest about absence:
   *  a runner that only knows the file exists states exactly what it always
   *  did.
   *
   *  **ABSENT and `[]` are different facts, and only one of them is about the
   *  code.** `[]` says this execution produced no files. ABSENT says this
   *  RUNNER does not report produced files at all — it has no declared output
   *  location to collect from, so "the code produced nothing" is a claim it is
   *  not in a position to make. `localCodeRunner` is in the second camp today
   *  (see its module header): it runs the code in a child process whose cwd is
   *  the caller's own working directory, and treating every file that appeared
   *  there as an output would be a guess about which files mattered, made on
   *  the machine least able to afford it. A runner that WANTS to produce
   *  output artifacts owes three things: a declared output location the code
   *  is told about, a bounded read-back of what landed there, and a `bytes`
   *  that is the payload's real length — then `codeRunnerTool` mints every
   *  data-carrying entry with no further wiring.
   *
   *  `data` is the in-band payload, present ONLY when the adapter can hand
   *  the bytes back (a local runner reading its own working directory, a
   *  managed sandbox that returns file contents). When a store is attached,
   *  `codeRunnerTool` mints every data-carrying entry into the artifact
   *  store and the model's result names the ref — entries without `data`
   *  stay described-only, because minting needs bytes and inventing them is
   *  worse than stating the gap. `mediaType` is the adapter's own statement
   *  when it knows one; `ref` is stamped by whoever minted the file into an
   *  artifact store (today: `codeRunnerTool`'s mint-on-output). */
  readonly artifacts?: readonly {
    readonly name: string;
    readonly bytes: number;
    readonly uri?: string;
    readonly mediaType?: string;
    readonly data?: string | Uint8Array;
    readonly ref?: string;
  }[];
  /** Present IFF output was cut — see {@link CodeTruncation}. An unstated
   *  slice is a silent success. */
  readonly truncated?: CodeTruncation;
}
