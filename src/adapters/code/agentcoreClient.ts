/**
 * The AgentCore Code Interpreter client seam: the operation-semantic surface
 * `agentCoreCodeRunner` calls, and its ONE mapping onto the real SDK.
 *
 * Two things this file owns and nothing else does:
 *
 *   • the COMMAND FORM — a bare `@aws-sdk/client-*` client is command-based:
 *     `client.send(new SomeCommand(input))`, never a method on the client
 *     (the 9.4.0 law; `BedrockAgentCoreClient.prototype.startCodeInterpreterSession`
 *     is `undefined`, the shortcut exists only on the aggregated client);
 *   • the DRAIN of `InvokeCodeInterpreterResponse.stream`, an event stream
 *     whose members are `{ result }` or a modelled EXCEPTION.
 *
 * The request and response shapes below were read off a real install of
 * `@aws-sdk/client-bedrock-agentcore` 3.1159.0 (`InvokeCodeInterpreterRequest`,
 * `ToolArguments`, `InputContentBlock`, `CodeInterpreterResult`,
 * `ResourceContent`, `ToolResultStructuredContent`) and are pinned against
 * transcribed copies of those types in
 * `test/type-regressions/AgentCoreCodeInterpreter.sdk.test.ts`.
 *
 * Pattern: Adapter (GoF) + lazy peer-dep load — the SDK is required only when
 * a session first starts (or never, if you inject `_client` / `_sdk`).
 */

import { abortableIterable } from '../../lib/abort.js';
import { lazyRequire } from '../../lib/lazyRequire.js';

/** The operation-semantic surface `agentCoreCodeRunner` calls. Inject your own as `_client`. */
export interface AgentCoreCodeClientLike {
  startSession(input: {
    readonly codeInterpreterIdentifier: string;
    readonly name?: string;
    readonly sessionTimeoutSeconds?: number;
  }): Promise<{ readonly sessionId?: string }>;
  /**
   * One `InvokeCodeInterpreter` call, its event stream already drained.
   *
   * `options.abortSignal` cancels the request where the client can; the
   * adapter also stops WAITING when it fires, so a client that ignores it
   * cannot hold a caller open.
   */
  invoke(
    input: AgentCoreInvokeInput,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<AgentCoreInvokeAnswer>;
  stopSession(input: {
    readonly codeInterpreterIdentifier: string;
    readonly sessionId: string;
  }): Promise<void>;
}

/** Which interpreter, and which of its sessions, one invoke goes to. */
export interface AgentCoreInvokeTarget {
  readonly codeInterpreterIdentifier: string;
  readonly sessionId: string;
}

/**
 * One file for `writeFiles` — AgentCore's `InputContentBlock`: TEXT for a
 * string, BYTES for a `Uint8Array`, never both, and never bytes smuggled
 * through text as base64.
 */
export type AgentCoreFileContent =
  | { readonly path: string; readonly text: string; readonly blob?: never }
  | { readonly path: string; readonly blob: Uint8Array; readonly text?: never };

/**
 * One `InvokeCodeInterpreter` request: the four of the service's tool names
 * this adapter sends, each with exactly the arguments AgentCore takes for it.
 */
export type AgentCoreInvokeInput = AgentCoreInvokeTarget &
  (
    | {
        readonly name: 'executeCode';
        readonly arguments: { readonly code: string; readonly language?: string };
      }
    | { readonly name: 'executeCommand'; readonly arguments: { readonly command: string } }
    | {
        readonly name: 'writeFiles';
        readonly arguments: { readonly content: readonly AgentCoreFileContent[] };
      }
    | { readonly name: 'readFiles'; readonly arguments: { readonly paths: readonly string[] } }
  );

/** What `invoke` reports back, already drained of its event stream — only what the service sent. */
export interface AgentCoreInvokeAnswer {
  readonly stdout: string;
  readonly stderr: string;
  /** The exit status the service reported; absent when no result carried one. */
  readonly exitCode?: number;
  /**
   * The service's own error flag: `true` when any result was flagged, `false`
   * when results said `false` and none said `true`, ABSENT when no result
   * carried the flag at all. Absent is not `false`.
   */
  readonly isError?: boolean;
  /** Every embedded resource the answer carried, in order — what `readFiles`
   *  answers with. Absent when there were none. */
  readonly resources?: readonly AgentCoreResource[];
}

/** One embedded resource (AgentCore's `ResourceContent`), as the service sent it. */
export interface AgentCoreResource {
  readonly uri?: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly blob?: Uint8Array;
}

/** The slice of `@aws-sdk/client-bedrock-agentcore` this shim touches. */
export interface BedrockAgentCoreCodeSdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
  };
  readonly StartCodeInterpreterSessionCommand?: new (input: unknown) => unknown;
  readonly InvokeCodeInterpreterCommand?: new (input: unknown) => unknown;
  readonly StopCodeInterpreterSessionCommand?: new (input: unknown) => unknown;
}

/** The tool names whose answer is only an answer if it carried a result. */
const RESULT_REQUIRED: ReadonlySet<AgentCoreInvokeInput['name']> = new Set([
  'writeFiles',
  'readFiles',
]);

/**
 * Map {@link AgentCoreCodeClientLike} onto the real SDK commands.
 */
export function createCodeClient(options: {
  readonly region?: string;
  readonly _sdk?: BedrockAgentCoreCodeSdkModule;
}): AgentCoreCodeClientLike {
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
    abortSignal?: AbortSignal,
  ): Promise<unknown> => {
    if (!Ctor) {
      throw new Error(
        `agentCoreCodeRunner: \`@aws-sdk/client-bedrock-agentcore\` is missing ${name}. ` +
          'Upgrade the SDK, or pass `_client` with your own mapping.',
      );
    }
    return abortSignal ? sdk.send(new Ctor(input), { abortSignal }) : sdk.send(new Ctor(input));
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
    async invoke(input, invokeOptions) {
      const abortSignal = invokeOptions?.abortSignal;
      const r = (await send(
        mod.InvokeCodeInterpreterCommand,
        'InvokeCodeInterpreterCommand',
        input,
        abortSignal,
      )) as { stream?: AsyncIterable<CodeInterpreterStreamOutputLike> } | null;
      return drainStream(r?.stream, {
        requireResult: RESULT_REQUIRED.has(input.name),
        ...(abortSignal && { signal: abortSignal }),
      });
    },
    async stopSession(input) {
      await send(mod.StopCodeInterpreterSessionCommand, 'StopCodeInterpreterSessionCommand', input);
    },
  };
}

/** One event off `InvokeCodeInterpreterResponse.stream` — the fields this adapter reads. */
export interface CodeInterpreterStreamOutputLike {
  readonly result?: {
    readonly content?: readonly {
      readonly type?: string;
      readonly text?: string;
      readonly name?: string;
      readonly resource?: AgentCoreResource;
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
export const STREAM_ERROR_MEMBERS = [
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
 *
 * Nothing is filled in that the stream did not carry: no exit status, no
 * error flag. And a file operation whose stream ended with no result at all
 * (`requireResult`) is a broken call, not an empty answer.
 */
export async function drainStream(
  stream: AsyncIterable<CodeInterpreterStreamOutputLike> | undefined,
  options: { readonly requireResult: boolean; readonly signal?: AbortSignal },
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
  let isError: boolean | undefined;
  let results = 0;
  const resources: AgentCoreResource[] = [];
  for await (const event of abortableIterable(stream, options.signal)) {
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
    results += 1;
    if (result.isError === true) isError = true;
    else if (result.isError === false && isError === undefined) isError = false;
    for (const block of result.content ?? []) {
      if (block.resource !== undefined && block.resource !== null) resources.push(block.resource);
    }
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
  if (options.requireResult && results === 0) {
    throw new Error(
      'agentCoreCodeRunner: InvokeCodeInterpreter answered a file operation with no result. ' +
        'Nothing confirmed it, so it is not reported as done.',
    );
  }
  return {
    stdout,
    stderr,
    ...(exitCode !== undefined && { exitCode }),
    ...(isError !== undefined && { isError }),
    ...(resources.length > 0 && { resources }),
  };
}
