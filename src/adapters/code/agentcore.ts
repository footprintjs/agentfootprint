/**
 * agentCoreCodeRunner — AWS Bedrock AgentCore Code Interpreter behind the
 * {@link CodeRunner} port (peer-dep `@aws-sdk/client-bedrock-agentcore`).
 *
 *   import { agentCoreCodeRunner } from 'agentfootprint/providers';
 *   const runner = agentCoreCodeRunner({ region: 'us-east-1', identifier: 'aws.codeinterpreter.v1' });
 *
 * A REAL sandbox, which is the point: `localCodeRunner` gives you process
 * isolation on your own machine and says so; this gives you a managed,
 * network-and-filesystem-isolated environment, and the tool code is identical
 * across the swap.
 *
 * ── The operations, verified against the SDK ────────────────────────────────
 * Pinned in `test/adapters/aws/awsCommandPin.ts`. The three commands were
 * verified against a real install of `@aws-sdk/client-bedrock-agentcore`
 * 3.1108.0, and the four `InvokeCodeInterpreter` tool shapes below against
 * 3.1159.0:
 *
 *   • `StartCodeInterpreterSessionCommand`
 *       in  `{ codeInterpreterIdentifier, name?, sessionTimeoutSeconds? }`
 *       out `{ codeInterpreterIdentifier, sessionId, createdAt }`
 *   • `InvokeCodeInterpreterCommand` — `{ codeInterpreterIdentifier, sessionId,
 *       name, arguments }`, one service tool per call:
 *       `executeCode`    `{ code, language? }`        → `execute`
 *       `writeFiles`     `{ content: [{ path, text } | { path, blob }] }` → `stageInputs`
 *       `readFiles`      `{ paths: [path] }`           → `readFile`
 *       `executeCommand` `{ command }`                 → `runCommand`
 *     out `{ sessionId, stream }` — an **event stream**, not a body
 *   • `StopCodeInterpreterSessionCommand`
 *       in  `{ codeInterpreterIdentifier, sessionId }`   ← the session ID, not a URI
 *
 * **`Invoke` answers with an `AsyncIterable`** whose members are `{ result }`
 * or a modelled EXCEPTION, and `./agentcoreClient.ts` drains it: exception
 * members raise BY NAME, result members fold into one answer — and nothing
 * the stream did not carry is filled in.
 *
 * ── Results say only what the service reported ──────────────────────────────
 * `CodeResult.ok` is `true` or `false` only when the service said which: an
 * exit status, or its own `isError` verdict. When it reported neither, `ok`
 * is ABSENT — unknown. (It used to be `true`: success from silence.) A
 * command's `exitCode` is the reported one or absent, never read off `isError`.
 *
 * ── Files in and out, exactly and bounded ───────────────────────────────────
 * `stageInputs` writes TEXT as text and BYTES as a blob — never base64 inside
 * text with a decode step — in ONE `writeFiles` call, refused before it is
 * sent when its body would pass AgentCore's 100 MB per-call limit. AgentCore
 * takes no environment, so `AF_STAGED_INPUTS` reaches code by one setup
 * execution per runtime and manifest (confirmed by the line it prints) and
 * reaches a command as an `export` line ahead of it. `readFile` reads ONE path
 * and pairs the file to it by the URI the service returned, failing closed on
 * a missing or different one; text or bytes is whichever field the service
 * filled, and a file over `maxBytes` is refused, never cut.
 *
 * ── Commands are opt-in ─────────────────────────────────────────────────────
 * `runCommand` runs arbitrary shell, so a session has it only when the runner
 * is built with `commands: true`. The sandbox's network is whatever the code
 * interpreter resource was created with — the built-in `aws.codeinterpreter.v1`
 * runs with AWS's most restrictive defaults (Sandbox mode: limited network
 * access, Amazon S3 included); a custom interpreter may be Public (internet)
 * or VPC. This adapter can neither see nor change that.
 *
 * ── A session that is gone says so, once ────────────────────────────────────
 * A `ResourceNotFoundException`, or a service error saying the session is "not
 * active", becomes {@link SessionExpiredError} on every verb.
 *
 * ── How this talks to the SDK (the 9.4.0 law) ───────────────────────────────
 * Through `client.send(new SomeCommand(input))`, never a method on the client.
 * A bare `@aws-sdk/client-*` **Client is command-based**: its prototype carries
 * `send` and `destroy` and nothing else. Three adapters have shipped that bug
 * in this package.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 * Standard AWS credential resolution (the SDK's own chain). A tool holding a
 * long-lived session must NOT cache a `Credential` object from `ctx.credential`
 * past the call that produced it — a session outliving a run outlives its
 * token. Re-resolve per execute through `ctx.credentials`.
 *
 * Pattern: Adapter (GoF) + lazy peer-dep load — the SDK is required only when
 * `start()` first runs (or never, if you inject `_client` / `_sdk`).
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
import { CodeSandboxError, readBound, sandboxPath } from '../../provider-contract/codeSandbox.js';
import { SessionExpiredError } from '../../provider-contract/sessionExpired.js';
import { hashSessionKey } from '../../tools/toolSessions.js';
import {
  abortErrorOf,
  armDeadline,
  linkedController,
  throwIfAborted,
  untilAborted,
} from '../../lib/abort.js';
import {
  createCodeClient,
  type AgentCoreCodeClientLike,
  type AgentCoreInvokeAnswer,
  type AgentCoreInvokeInput,
  type BedrockAgentCoreCodeSdkModule,
} from './agentcoreClient.js';
import {
  AGENTCORE_MAX_REQUEST_BYTES,
  MANIFEST_SET_MARKER,
  STAGED_INPUTS_DIR,
  fileContent,
  manifestRuntime,
  manifestSetupCode,
  pairReadFile,
  serviceRefusal,
  sessionExpiryEvidence,
  withManifestExport,
  writeFilesRequestBytes,
} from './agentcoreWire.js';
import { safeFileName } from './fileName.js';
import { boundOutput, commandBounds, commandResult, payloadBytes, printedLine } from './output.js';

export type {
  AgentCoreCodeClientLike,
  AgentCoreFileContent,
  AgentCoreInvokeAnswer,
  AgentCoreInvokeInput,
  AgentCoreInvokeTarget,
  AgentCoreResource,
  BedrockAgentCoreCodeSdkModule,
} from './agentcoreClient.js';

export interface AgentCoreCodeRunnerOptions {
  readonly region?: string;
  /**
   * The code-interpreter resource to run in — AWS's built-in
   * (`'aws.codeinterpreter.v1'`) or your own custom interpreter's identifier.
   * Its network mode (Sandbox, Public or VPC) is set on the resource, not here.
   */
  readonly identifier: string;
  /**
   * Session TTL in seconds. AgentCore terminates the session past it regardless
   * of activity. Service default 900 (15 min); max 28,800 (8 h).
   *
   * **This is why "already gone" is a normal outcome, not an incident**: the
   * far side reaps on its own schedule, so a `Stop` may arrive after AWS has
   * already collected the session. `stop()` treats that as done, and every
   * other verb raises `SessionExpiredError`.
   */
  readonly sessionTimeoutSeconds?: number;
  /** Default language when a call does not name one. `'python'` (the service
   *  accepts `javascript`, `python`, `typescript`). */
  readonly language?: string;
  /** Per-stream output ceiling, in characters. Default 8000; anything cut is
   *  REPORTED on `CodeResult.truncated`, never dropped quietly. */
  readonly maxOutputChars?: number;
  /**
   * Give each session `runCommand` — one shell command through AgentCore's
   * `executeCommand`. Default `false`, and then the member is ABSENT
   * (`canRunCodeCommands` says no): it runs arbitrary shell, so a runner offers
   * it only when built to. Build one runner per agent that should have it.
   */
  readonly commands?: boolean;
  /** Stable id (default `'agentcore-code-runner'`). Rides the session events. */
  readonly id?: string;
  /** Test seam — inject a client implementing {@link AgentCoreCodeClientLike}.
   *  Bypasses the SDK entirely; the field mapping is then yours. */
  readonly _client?: AgentCoreCodeClientLike;
  /** @internal Test injection — the AWS SDK module, to exercise the real shim
   *  (`send(new Command(...))`) with a fake SDK. */
  readonly _sdk?: BedrockAgentCoreCodeSdkModule;
}

const DEFAULT_MAX_OUTPUT_CHARS = 8_000;
/** The adapter's own name, on every refusal it raises. */
const BACKEND = 'agentCoreCodeRunner';

export function agentCoreCodeRunner(options: AgentCoreCodeRunnerOptions): CodeRunner {
  const id = options.id ?? 'agentcore-code-runner';
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  let client: AgentCoreCodeClientLike | undefined;
  const resolve = (): AgentCoreCodeClientLike => {
    client ??= options._client ?? createCodeClient(options);
    return client;
  };

  return {
    id,
    async start(req): Promise<CodeSession> {
      const api = resolve();
      const started = await api.startSession({
        codeInterpreterIdentifier: options.identifier,
        // The DIGEST of the isolation key labels the session on AWS's side, so
        // an operator reading the console sees the same partition the runtime
        // enforces — and sees it under the same digest the trace publishes.
        // The key itself never leaves this process; see `sessionName`.
        name: sessionName(req.key),
        ...(options.sessionTimeoutSeconds !== undefined && {
          sessionTimeoutSeconds: options.sessionTimeoutSeconds,
        }),
      });
      const sessionId = started.sessionId;
      if (!sessionId) {
        throw new Error(
          'agentCoreCodeRunner: StartCodeInterpreterSession returned no sessionId. ' +
            'Nothing can be invoked or stopped without one, so this is raised rather than ' +
            'carried forward as an unusable session.',
        );
      }
      return openSession({
        api,
        identifier: options.identifier,
        sessionId,
        language: req.language ?? options.language,
        maxOutputChars,
        commands: options.commands === true,
      });
    },
  };
}

/** What one open session needs to know. */
interface SessionPlan {
  readonly api: AgentCoreCodeClientLike;
  readonly identifier: string;
  readonly sessionId: string;
  /** The session's default language (the start request's, else the runner's). */
  readonly language: string | undefined;
  readonly maxOutputChars: number;
  readonly commands: boolean;
}

/** How long one invoke may take, and what can cut it short. */
interface InvokeBounds {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** The session behind {@link agentCoreCodeRunner}: the verbs, in the order a caller uses them. */
function openSession(plan: SessionPlan): CodeSession {
  const { api, identifier, sessionId, maxOutputChars } = plan;
  const target = { codeInterpreterIdentifier: identifier, sessionId };
  let stopped = false;
  /** name → path, exactly as the manifest carries it. */
  const staged = new Map<string, string>();
  /** runtime → the manifest JSON last confirmed set in it. */
  const manifestSetIn = new Map<string, string>();

  const refuseIfStopped = (toDo: string): void => {
    if (stopped) {
      throw new Error(
        `agentCoreCodeRunner: session ${sessionId} was stopped; open a new one to ${toDo}.`,
      );
    }
  };
  const manifestJson = (): string | undefined =>
    staged.size > 0 ? JSON.stringify(Object.fromEntries(staged)) : undefined;

  /**
   * One invoke under the caller's bounds. A deadline or the caller's own
   * signal stops the WAIT at once (`lib/abort.ts`); what the service does
   * with a request it already received is its own business, and the timeout
   * error says so. A gone session becomes `SessionExpiredError`; a modelled
   * service error on a file or command call is rewritten without the
   * service's words (they can quote what was sent).
   */
  const invoke = async (
    input: AgentCoreInvokeInput,
    bounds: InvokeBounds,
  ): Promise<AgentCoreInvokeAnswer> => {
    throwIfAborted(bounds.signal);
    const { controller, unlink } = linkedController(bounds.signal);
    const disarm =
      bounds.timeoutMs === undefined
        ? undefined
        : armDeadline(
            controller,
            bounds.timeoutMs,
            () =>
              new CodeSandboxError(
                'timed-out',
                `agentCoreCodeRunner: ${input.name} did not answer within ${bounds.timeoutMs}ms ` +
                  'and was abandoned. The session was not stopped, so what was sent may still ' +
                  'be running in it — whether it finished is not known.',
              ),
          );
    try {
      return await untilAborted(
        api.invoke(input, { abortSignal: controller.signal }),
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) throw abortErrorOf(controller.signal);
      const evidence = sessionExpiryEvidence(err);
      if (evidence !== undefined) throw new SessionExpiredError(BACKEND, sessionId, evidence);
      if (input.name === 'executeCode') throw err;
      throw serviceRefusal(err, input.name) ?? err;
    } finally {
      disarm?.();
      unlink();
    }
  };

  /**
   * Make sure the runtime `language` runs in can read {@link STAGED_INPUTS_ENV}.
   * Nothing when nothing was staged — a session that never stages sends
   * exactly what it always sent.
   */
  const exposeManifest = async (
    language: string | undefined,
    bounds: InvokeBounds,
  ): Promise<void> => {
    const json = manifestJson();
    if (json === undefined) return;
    const runtime = manifestRuntime(language);
    if (runtime === undefined) {
      throw new CodeSandboxError(
        'staged-inputs-unset',
        `agentCoreCodeRunner: inputs were staged, and this adapter does not know how to set ` +
          `AF_STAGED_INPUTS for language '${String(language)}', so the code is not run against ` +
          'a manifest it could not read. AgentCore runs python, javascript and typescript.',
      );
    }
    if (manifestSetIn.get(runtime) === json) return;
    const answer = await invoke(
      {
        ...target,
        name: 'executeCode',
        arguments: { code: manifestSetupCode(runtime, json), ...(language ? { language } : {}) },
      },
      bounds,
    );
    // The setup prints one line once the variable is set — it proves that
    // checkpoint and nothing else, which is all that is asked of it.
    if (!printedLine(answer.stdout, MANIFEST_SET_MARKER)) {
      throw new CodeSandboxError(
        'staged-inputs-unset',
        `agentCoreCodeRunner: the staged inputs are in the session, but setting AF_STAGED_INPUTS ` +
          `in its ${runtime} runtime was not confirmed, so the code is not run against a ` +
          'manifest it may not be able to read.',
      );
    }
    manifestSetIn.set(runtime, json);
  };

  const session: CodeSession = {
    id: sessionId,
    async execute(exec): Promise<CodeResult> {
      refuseIfStopped('run more code');
      const language = exec.language ?? plan.language;
      const bounds: InvokeBounds = {
        ...(exec.timeoutMs !== undefined && { timeoutMs: exec.timeoutMs }),
        ...(exec.signal && { signal: exec.signal }),
      };
      await exposeManifest(language, bounds);
      const answer = await invoke(
        {
          ...target,
          name: 'executeCode',
          arguments: { code: exec.code, ...(language ? { language } : {}) },
        },
        bounds,
      );
      const bounded = boundOutput(answer.stdout, answer.stderr, maxOutputChars);
      const ok = reportedOutcome(answer);
      return {
        ...(ok !== undefined && { ok }),
        stdout: bounded.stdout,
        stderr: bounded.stderr,
        ...(answer.exitCode !== undefined && { exitCode: answer.exitCode }),
        ...(bounded.truncated !== undefined && { truncated: bounded.truncated }),
      };
    },
    async stageInputs(inputs: readonly CodeInput[]): Promise<readonly StagedCodeInput[]> {
      refuseIfStopped('stage inputs');
      if (inputs.length === 0) return [];
      // The name is CALLER data landing in a filesystem, so it is ENCODED
      // into one inert segment — the same encoder `localCodeRunner` uses, so
      // a name lands under the same file name on either backend.
      const landing = inputs.map((input) => ({
        input,
        path: `${STAGED_INPUTS_DIR}/${safeFileName(input.fileName ?? input.name)}`,
      }));
      const content = landing.map(({ input, path }) => fileContent(path, input.data));
      const bytes = writeFilesRequestBytes(content);
      if (bytes > AGENTCORE_MAX_REQUEST_BYTES) {
        throw new CodeSandboxError(
          'request-too-large',
          `agentCoreCodeRunner: staging these ${inputs.length} input(s) would send a ` +
            `${bytes}-byte request, and AgentCore takes at most ${AGENTCORE_MAX_REQUEST_BYTES} ` +
            'bytes in one call. Nothing was sent. Stage fewer or smaller inputs per call, or ' +
            'have the code fetch large data itself (from Amazon S3, for example).',
          { bytes, limit: AGENTCORE_MAX_REQUEST_BYTES },
        );
      }
      const answer = await invoke({ ...target, name: 'writeFiles', arguments: { content } }, {});
      if (answer.isError === true) {
        throw new CodeSandboxError(
          'write-failed',
          'agentCoreCodeRunner: the service flagged the write of the staged inputs as an error, ' +
            'so which of them landed is not known. Its words are not repeated here.',
        );
      }
      for (const { input, path } of landing) staged.set(input.name, path);
      return landing.map(({ input, path }) => ({
        name: input.name,
        path,
        bytes: payloadBytes(input.data),
      }));
    },
    async readFile(path: string, readOptions: CodeReadOptions): Promise<CodeFile> {
      refuseIfStopped('read files');
      const maxBytes = readBound(readOptions);
      const relative = sandboxPath(path);
      const answer = await invoke(
        { ...target, name: 'readFiles', arguments: { paths: [relative] } },
        { ...(readOptions.signal && { signal: readOptions.signal }) },
      );
      return pairReadFile(relative, answer, maxBytes);
    },
    ...(plan.commands && {
      async runCommand(
        command: string,
        commandOptions?: CodeCommandOptions,
      ): Promise<CodeCommandResult> {
        refuseIfStopped('run commands');
        const bounds = commandBounds(command, commandOptions, maxOutputChars);
        const json = manifestJson();
        const answer = await invoke(
          {
            ...target,
            name: 'executeCommand',
            arguments: {
              command: json === undefined ? command : withManifestExport(command, json),
            },
          },
          {
            ...(bounds.timeoutMs !== undefined && { timeoutMs: bounds.timeoutMs }),
            ...(bounds.signal && { signal: bounds.signal }),
          },
        );
        return commandResult(answer, bounds);
      },
    }),
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      staged.clear();
      manifestSetIn.clear();
      try {
        await api.stopSession({ codeInterpreterIdentifier: identifier, sessionId });
      } catch (err) {
        // "Already gone" is the EXPECTED shape here, not an incident: the
        // session TTL is enforced by AWS, so a run that idled past it finds
        // the session collected. Anything else is re-raised, and the tier
        // reports it on `tools.session_close_failed`.
        if (!isAlreadyGone(err)) throw err;
      }
    },
  };
  return session;
}

/**
 * Did the code complete — as far as the service SAID?
 *
 * Its own error verdict first, then an exit status, then its explicit
 * "not an error". When it said none of those, the answer is `undefined`:
 * unknown, never success from silence.
 */
function reportedOutcome(answer: AgentCoreInvokeAnswer): boolean | undefined {
  if (answer.isError === true) return false;
  if (answer.exitCode !== undefined) return answer.exitCode === 0;
  if (answer.isError === false) return true;
  return undefined;
}

/**
 * A label for the remote session — derived FROM the isolation key, carrying
 * none of it.
 *
 * **Why not the key itself.** The isolation key is
 * `t=<tenant>/p=<principal>/s=<sessionId>` (see `toolSessionKey`), so it holds
 * a tenant name, a principal and the hosting session id. The previous version
 * of this function folded that string's illegal characters to `-` and sent the
 * result to AWS as `StartCodeInterpreterSession`'s `name` — which put
 * `af-t-acme-p-alice-s-s1` into a vendor control plane, its console, and its
 * audit log, for every session opened. One module over,
 * {@link hashSessionKey} exists precisely so the same identifiers never reach
 * the event wire ("enough to JOIN two rows and not enough to name whose they
 * are"). Two opposite decisions about one string; this is the one that agrees
 * with the rest of the library.
 *
 * **What it buys beyond not leaking.** The label is now byte-identical to the
 * `keyHash` on `agentfootprint.tools.session_closed`, so an operator with a
 * session in the AWS console can actually FIND its rows in the trace. The fold
 * could not do that: `alice:1` and `alice-1` produced one label, and any key
 * over 100 characters was truncated onto its neighbours, so the console name
 * an operator read did not identify one partition.
 *
 * **Not an address.** AWS documents `name` as a non-unique friendly handle;
 * nothing — here or in the SDK — ever looks a session up by it. The address is
 * the service-assigned `sessionId`, which `start()` reads back and passes to
 * every `Invoke` and `Stop` verbatim. So no stored state is keyed on this
 * string and relabelling migrates nothing — and no session is ever reattached
 * by it.
 */
function sessionName(key: string): string {
  return `af-${hashSessionKey(key)}`;
}

function isAlreadyGone(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'ResourceNotFoundException' || name === 'ValidationException';
}
