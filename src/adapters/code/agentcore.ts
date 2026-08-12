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
 * ── The three operations, verified against the SDK ──────────────────────────
 * Pinned in `test/adapters/aws/awsCommandPin.ts`, and verified against a real
 * install of `@aws-sdk/client-bedrock-agentcore` 3.1108.0:
 *
 *   • `StartCodeInterpreterSessionCommand`
 *       in  `{ codeInterpreterIdentifier, name?, sessionTimeoutSeconds? }`
 *       out `{ codeInterpreterIdentifier, sessionId, createdAt }`
 *   • `InvokeCodeInterpreterCommand`
 *       in  `{ codeInterpreterIdentifier, sessionId, name: 'executeCode',
 *              arguments: { code, language } }`
 *       out `{ sessionId, stream }` — an **event stream**, not a body (below)
 *   • `StopCodeInterpreterSessionCommand`
 *       in  `{ codeInterpreterIdentifier, sessionId }`   ← the session ID, not a URI
 *       out `{ codeInterpreterIdentifier, sessionId, lastUpdatedAt }`
 *
 * **`Invoke` answers with an `AsyncIterable`.** `InvokeCodeInterpreterResponse`
 * is `{ sessionId?, stream?: AsyncIterable<CodeInterpreterStreamOutput> }`, and
 * every member of that union is either `{ result }` or a modelled EXCEPTION —
 * `accessDeniedException`, `throttlingException`, `validationException`, and
 * four more. An adapter that read a `body` field would find `undefined` and
 * report an empty success on every call, and one that iterated only for
 * `result` would treat an AccessDenied as "the code printed nothing." So this
 * drains the stream, raises the exception members BY NAME, and folds the
 * result members into one `CodeResult`.
 *
 * The payload lands twice: `structuredContent` carries `{ stdout, stderr,
 * exitCode, executionTime }` and `content[]` carries typed blocks. The
 * structured half is preferred because it is typed; the text blocks are the
 * fallback for a response that only filled the other one.
 *
 * ── How this talks to the SDK (the 9.4.0 law) ───────────────────────────────
 * Through `client.send(new SomeCommand(input))`, never a method on the client.
 * A bare `@aws-sdk/client-*` **Client is command-based**: its prototype carries
 * `send` and `destroy` and nothing else — verified again for this adapter
 * (`BedrockAgentCoreClient.prototype.startCodeInterpreterSession` is
 * `undefined`; the shortcut exists only on the aggregated `BedrockAgentCore`).
 * Three adapters have shipped that bug in this package.
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

import type { CodeResult, CodeRunner, CodeSession } from '../types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';

export interface AgentCoreCodeRunnerOptions {
  readonly region?: string;
  /**
   * The code-interpreter resource to run in — AWS's built-in
   * (`'aws.codeinterpreter.v1'`) or your own custom interpreter's identifier.
   */
  readonly identifier: string;
  /**
   * Session TTL in seconds. AgentCore terminates the session past it regardless
   * of activity. Service default 900 (15 min); max 28,800 (8 h).
   *
   * **This is why "already gone" is a normal outcome, not an incident**: the
   * far side reaps on its own schedule, so a `Stop` may arrive after AWS has
   * already collected the session. `stop()` treats that as done.
   */
  readonly sessionTimeoutSeconds?: number;
  /** Default language when a call does not name one. `'python'` (the service
   *  accepts `javascript`, `python`, `typescript`). */
  readonly language?: string;
  /** Per-stream output ceiling, in characters. Default 8000; anything cut is
   *  REPORTED on `CodeResult.truncated`, never dropped quietly. */
  readonly maxOutputChars?: number;
  /** Stable id (default `'agentcore-code-runner'`). Rides the session events. */
  readonly id?: string;
  /** Test seam — inject a client implementing {@link AgentCoreCodeClientLike}.
   *  Bypasses the SDK entirely; the field mapping below is then yours. */
  readonly _client?: AgentCoreCodeClientLike;
  /** @internal Test injection — the AWS SDK module, to exercise the real shim
   *  (`send(new Command(...))`) with a fake SDK. */
  readonly _sdk?: BedrockAgentCoreCodeSdkModule;
}

/** The operation-semantic surface this adapter calls. */
export interface AgentCoreCodeClientLike {
  startSession(input: {
    readonly codeInterpreterIdentifier: string;
    readonly name?: string;
    readonly sessionTimeoutSeconds?: number;
  }): Promise<{ readonly sessionId?: string }>;
  invoke(input: {
    readonly codeInterpreterIdentifier: string;
    readonly sessionId: string;
    readonly name: string;
    readonly arguments: { readonly code: string; readonly language?: string };
  }): Promise<AgentCoreInvokeAnswer>;
  stopSession(input: {
    readonly codeInterpreterIdentifier: string;
    readonly sessionId: string;
  }): Promise<void>;
}

/** What `invoke` reports back, already drained of its event stream. */
export interface AgentCoreInvokeAnswer {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode?: number;
  readonly isError?: boolean;
}

/** The slice of `@aws-sdk/client-bedrock-agentcore` this shim touches. */
export interface BedrockAgentCoreCodeSdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly StartCodeInterpreterSessionCommand?: new (input: unknown) => unknown;
  readonly InvokeCodeInterpreterCommand?: new (input: unknown) => unknown;
  readonly StopCodeInterpreterSessionCommand?: new (input: unknown) => unknown;
}

const DEFAULT_MAX_OUTPUT_CHARS = 8_000;
/** The service's own name for "run this code". Not a name we chose. */
const EXECUTE_CODE = 'executeCode';

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
        // The isolation key names the session on AWS's side too, so an operator
        // reading the console sees the same partition the runtime enforces. It
        // is a HASH-free label AWS documents as non-unique; the key is already
        // the caller's own composition, never widened here.
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
      let stopped = false;
      return {
        id: sessionId,
        async execute(exec): Promise<CodeResult> {
          if (stopped) {
            throw new Error(
              `agentCoreCodeRunner: session ${sessionId} was stopped; open a new one to run more code.`,
            );
          }
          const answer = await api.invoke({
            codeInterpreterIdentifier: options.identifier,
            sessionId,
            name: EXECUTE_CODE,
            arguments: {
              code: exec.code,
              ...(exec.language ?? req.language ?? options.language
                ? { language: exec.language ?? req.language ?? options.language ?? 'python' }
                : {}),
            },
          });
          const stdout = cut(answer.stdout, maxOutputChars);
          const stderr = cut(answer.stderr, maxOutputChars);
          const truncated = {
            ...(stdout.cut && { stdout: true }),
            ...(stderr.cut && { stderr: true }),
            ...((stdout.cut || stderr.cut) && {
              ofChars: Math.max(answer.stdout.length, answer.stderr.length),
            }),
          };
          return {
            // `isError` is the service's own verdict; a non-zero exit is ours.
            ok: answer.isError !== true && (answer.exitCode ?? 0) === 0,
            stdout: stdout.text,
            stderr: stderr.text,
            ...(answer.exitCode !== undefined && { exitCode: answer.exitCode }),
            ...(Object.keys(truncated).length > 0 && { truncated }),
          };
        },
        async stop(): Promise<void> {
          if (stopped) return;
          stopped = true;
          try {
            await api.stopSession({
              codeInterpreterIdentifier: options.identifier,
              sessionId,
            });
          } catch (err) {
            // "Already gone" is the EXPECTED shape here, not an incident: the
            // session TTL is enforced by AWS, so a run that idled past it finds
            // the session collected. Anything else is re-raised, and the tier
            // reports it on `tools.session_close_failed`.
            if (!isAlreadyGone(err)) throw err;
          }
        },
      };
    },
  };
}

/** A session label from the isolation key — AWS's `name` is a human handle. */
function sessionName(key: string): string {
  // Keep it recognisable and within the service's naming charset.
  return `af-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`.slice(0, 100);
}

function isAlreadyGone(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'ResourceNotFoundException' || name === 'ValidationException';
}

/**
 * Map {@link AgentCoreCodeClientLike} onto the real SDK commands.
 *
 * Two things this function owns and nothing else does: the COMMAND FORM (see
 * the module header), and the DRAIN of `InvokeCodeInterpreterResponse.stream`.
 */
function createCodeClient(options: AgentCoreCodeRunnerOptions): AgentCoreCodeClientLike {
  let mod: BedrockAgentCoreCodeSdkModule;
  if (options._sdk) {
    mod = options._sdk;
  } else {
    try {
      // Lazy peer-dep: only loaded when no _client/_sdk is injected and start() runs.
      mod = lazyRequire<BedrockAgentCoreCodeSdkModule>('@aws-sdk/client-bedrock-agentcore');
    } catch {
      throw new Error(
        'agentCoreCodeRunner requires the `@aws-sdk/client-bedrock-agentcore` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-agentcore\n' +
          '  Or pass `_client` for a pre-built or mock client.\n' +
          '  For a local dev loop with no AWS at all, use `localCodeRunner()`.',
      );
    }
  }
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      'agentCoreCodeRunner: `@aws-sdk/client-bedrock-agentcore` is installed but ' +
        '`BedrockAgentCoreClient` was not found. Update the SDK.',
    );
  }
  const sdk = new mod.BedrockAgentCoreClient({ ...(options.region && { region: options.region }) });

  const send = async (
    Ctor: (new (i: unknown) => unknown) | undefined,
    name: string,
    input: unknown,
  ): Promise<unknown> => {
    if (!Ctor) {
      throw new Error(
        `agentCoreCodeRunner: \`@aws-sdk/client-bedrock-agentcore\` is missing ${name}. ` +
          'Upgrade the SDK, or pass `_client` with your own mapping.',
      );
    }
    return sdk.send(new Ctor(input));
  };

  return {
    async startSession(input) {
      const r = (await send(
        mod.StartCodeInterpreterSessionCommand,
        'StartCodeInterpreterSessionCommand',
        input,
      )) as { sessionId?: string } | null;
      return { ...(r?.sessionId !== undefined && { sessionId: r.sessionId }) };
    },
    async invoke(input) {
      const r = (await send(
        mod.InvokeCodeInterpreterCommand,
        'InvokeCodeInterpreterCommand',
        input,
      )) as { stream?: AsyncIterable<CodeInterpreterStreamOutputLike> } | null;
      return drainStream(r?.stream);
    },
    async stopSession(input) {
      await send(mod.StopCodeInterpreterSessionCommand, 'StopCodeInterpreterSessionCommand', input);
    },
  };
}

/** One event off `InvokeCodeInterpreterResponse.stream`. */
interface CodeInterpreterStreamOutputLike {
  readonly result?: {
    readonly content?: readonly {
      readonly type?: string;
      readonly text?: string;
      readonly name?: string;
    }[];
    readonly structuredContent?: {
      readonly stdout?: string;
      readonly stderr?: string;
      readonly exitCode?: number;
    };
    readonly isError?: boolean;
  };
  readonly accessDeniedException?: { readonly message?: string };
  readonly conflictException?: { readonly message?: string };
  readonly internalServerException?: { readonly message?: string };
  readonly resourceNotFoundException?: { readonly message?: string };
  readonly serviceQuotaExceededException?: { readonly message?: string };
  readonly throttlingException?: { readonly message?: string };
  readonly validationException?: { readonly message?: string };
}

/** Every modelled error member of the stream union, in SDK spelling. */
const STREAM_ERROR_MEMBERS = [
  'accessDeniedException',
  'conflictException',
  'internalServerException',
  'resourceNotFoundException',
  'serviceQuotaExceededException',
  'throttlingException',
  'validationException',
] as const;

/**
 * Drain the event stream into one answer.
 *
 * An ERROR MEMBER RAISES. This is the honesty line for this adapter: the SDK
 * models seven failure shapes as ordinary members of the stream union, so an
 * `AccessDeniedException` arrives as a value, not a rejection. Folding it in
 * as empty output would report a clean run in which the code "printed
 * nothing" — a silent success, at the exact moment an operator most needs the
 * word "AccessDenied".
 */
async function drainStream(
  stream: AsyncIterable<CodeInterpreterStreamOutputLike> | undefined,
): Promise<AgentCoreInvokeAnswer> {
  if (!stream) {
    throw new Error(
      'agentCoreCodeRunner: InvokeCodeInterpreter returned no stream. The response carries ' +
        'its payload as an event stream (`response.stream`), so an absent one is a broken ' +
        'call, not an empty result.',
    );
  }
  let stdout = '';
  let stderr = '';
  let exitCode: number | undefined;
  let isError = false;
  for await (const event of stream) {
    for (const member of STREAM_ERROR_MEMBERS) {
      const raised = event[member];
      if (raised) {
        const error = new Error(
          `agentCoreCodeRunner: ${member} from InvokeCodeInterpreter — ` +
            `${raised.message ?? 'no message supplied'}`,
        );
        error.name = member.charAt(0).toUpperCase() + member.slice(1);
        throw error;
      }
    }
    const result = event.result;
    if (!result) continue;
    if (result.isError === true) isError = true;
    const structured = result.structuredContent;
    if (structured) {
      if (structured.stdout !== undefined) stdout += structured.stdout;
      if (structured.stderr !== undefined) stderr += structured.stderr;
      if (structured.exitCode !== undefined) exitCode = structured.exitCode;
    } else {
      // Fallback: a response that filled only the typed content blocks. Text
      // blocks are the readable half; a binary/resource block is described by
      // name rather than inlined, because inlining it is the bug this port exists
      // to prevent.
      for (const block of result.content ?? []) {
        if (block.text !== undefined) stdout += block.text;
        else if (block.name !== undefined) stdout += `[${block.type ?? 'resource'}: ${block.name}]`;
      }
    }
  }
  return {
    stdout,
    stderr,
    ...(exitCode !== undefined && { exitCode }),
    ...(isError && { isError }),
  };
}

/** Cut to `max` characters, saying whether it cut. */
function cut(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  return { text: text.slice(0, max), cut: true };
}
