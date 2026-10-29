/**
 * Compile-level pin — what `agentCoreCodeRunner` SENDS to InvokeCodeInterpreter
 * and what it READS back, held to the SDK's own declarations.
 *
 * The AWS SDKs are deliberately not installed in this repo
 * (`test/adapters/aws/awsCommandPin.ts` says why), so the declarations below
 * are TRANSCRIBED, member for member, from `@aws-sdk/client-bedrock-agentcore`
 * 3.1159.0 — `dist-types/models/models_0.d.ts` (`InputContentBlock`,
 * `ToolArguments`, `InvokeCodeInterpreterRequest`, `ResourceContent`,
 * `ContentBlock`, `ToolResultStructuredContent`, `CodeInterpreterResult`,
 * `CodeInterpreterStreamOutput`) and `dist-types/models/enums.d.ts`
 * (`ToolName`, `ProgrammingLanguage`, `ResourceContentType`,
 * `ContentBlockType`, `TaskStatus`). Documentation comments are dropped;
 * names, optionality and types are not.
 *
 * `npm run test:types` fails when the adapter:
 *   • names a tool the SDK does not list;
 *   • sends an argument key `ToolArguments` does not have, or a value of
 *     another type (a file entry that is not an `InputContentBlock`, a path
 *     list that is not `string[]`, a command that is not a string);
 *   • reads a field off the stream that the SDK's answer does not carry, or
 *     reads it as a type the SDK does not return.
 *
 * The runtime half — the same names in the REAL package's schema — runs in
 * `test/adapters/aws/aws-command-pin.test.ts` wherever the package is installed,
 * and the request shapes as they leave the process are pinned in
 * `test/adapters/code/agentcore-files-commands.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type {
  AgentCoreFileContent,
  AgentCoreInvokeInput,
  AgentCoreResource,
  CodeInterpreterStreamOutputLike,
} from '../../src/adapters/code/agentcoreClient';

// ── Transcribed: @aws-sdk/client-bedrock-agentcore 3.1159.0 ───────────────

type ToolName =
  | 'executeCode'
  | 'executeCommand'
  | 'getTask'
  | 'listFiles'
  | 'readFiles'
  | 'removeFiles'
  | 'startCommandExecution'
  | 'stopTask'
  | 'writeFiles';
type ProgrammingLanguage = 'javascript' | 'python' | 'typescript';
type LanguageRuntime = 'deno' | 'nodejs' | 'python';
type ResourceContentType = 'blob' | 'text';
type ContentBlockType = 'resource' | 'image' | 'resource_link' | 'text';
type TaskStatus = 'canceled' | 'completed' | 'failed' | 'submitted' | 'working';

interface InputContentBlock {
  path: string | undefined;
  text?: string | undefined;
  blob?: Uint8Array | undefined;
}
interface ToolArguments {
  code?: string | undefined;
  language?: ProgrammingLanguage | undefined;
  clearContext?: boolean | undefined;
  command?: string | undefined;
  path?: string | undefined;
  paths?: string[] | undefined;
  content?: InputContentBlock[] | undefined;
  directoryPath?: string | undefined;
  taskId?: string | undefined;
  runtime?: LanguageRuntime | undefined;
}
interface InvokeCodeInterpreterRequest {
  codeInterpreterIdentifier: string | undefined;
  sessionId?: string | undefined;
  traceId?: string | undefined;
  traceParent?: string | undefined;
  name: ToolName | undefined;
  arguments?: ToolArguments | undefined;
}
interface ResourceContent {
  type: ResourceContentType | undefined;
  uri?: string | undefined;
  mimeType?: string | undefined;
  text?: string | undefined;
  blob?: Uint8Array | undefined;
}
interface ContentBlock {
  type: ContentBlockType | undefined;
  text?: string | undefined;
  data?: Uint8Array | undefined;
  mimeType?: string | undefined;
  uri?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  size?: number | undefined;
  resource?: ResourceContent | undefined;
}
interface ToolResultStructuredContent {
  taskId?: string | undefined;
  taskStatus?: TaskStatus | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  exitCode?: number | undefined;
  executionTime?: number | undefined;
}
interface CodeInterpreterResult {
  content: ContentBlock[] | undefined;
  structuredContent?: ToolResultStructuredContent | undefined;
  isError?: boolean | undefined;
}
/** The modelled exceptions, as far as the stream members carry them. */
interface ServiceException<N extends string> {
  readonly name: N;
  message: string;
}
type CodeInterpreterStreamOutput =
  | { result: CodeInterpreterResult }
  | { accessDeniedException: ServiceException<'AccessDeniedException'> }
  | { conflictException: ServiceException<'ConflictException'> }
  | { internalServerException: ServiceException<'InternalServerException'> }
  | { resourceNotFoundException: ServiceException<'ResourceNotFoundException'> }
  | { serviceQuotaExceededException: ServiceException<'ServiceQuotaExceededException'> }
  | { throttlingException: ServiceException<'ThrottlingException'> }
  | { validationException: ServiceException<'ValidationException'> };
type StreamMemberKey =
  | 'result'
  | 'accessDeniedException'
  | 'conflictException'
  | 'internalServerException'
  | 'resourceNotFoundException'
  | 'serviceQuotaExceededException'
  | 'throttlingException'
  | 'validationException';

// ── The checks ───────────────────────────────────────────────────────────

/** `true` iff every key of A is a key of B. */
type KeysWithin<A, B> = Exclude<keyof A, keyof B> extends never ? true : false;
/** Compiles only for `true`. */
function holds<T extends true>(_proof: T): void {}

/** Strip `readonly`, so an assignment checks the wire shape, not TS's
 *  mutability — a readonly array goes out exactly as a mutable one does. */
type Writable<T> = T extends Uint8Array
  ? T
  : T extends readonly (infer U)[]
  ? Writable<U>[]
  : T extends object
  ? { -readonly [K in keyof T]: Writable<T[K]> }
  : T;

type Arm<N extends AgentCoreInvokeInput['name']> = Writable<
  Extract<AgentCoreInvokeInput, { name: N }>
>;

// SENDING — every tool name is the SDK's, every argument key exists, and each
// file / command / path request is assignable to the SDK request as it is.
holds<AgentCoreInvokeInput['name'] extends ToolName ? true : false>(true);
holds<KeysWithin<Arm<'writeFiles'>['arguments'], ToolArguments>>(true);
holds<KeysWithin<Arm<'readFiles'>['arguments'], ToolArguments>>(true);
holds<KeysWithin<Arm<'executeCommand'>['arguments'], ToolArguments>>(true);
holds<KeysWithin<Arm<'executeCode'>['arguments'], ToolArguments>>(true);
holds<KeysWithin<Arm<'writeFiles'>, InvokeCodeInterpreterRequest>>(true);
holds<Writable<AgentCoreFileContent> extends InputContentBlock ? true : false>(true);
holds<Arm<'writeFiles'> extends InvokeCodeInterpreterRequest ? true : false>(true);
holds<Arm<'readFiles'> extends InvokeCodeInterpreterRequest ? true : false>(true);
holds<Arm<'executeCommand'> extends InvokeCodeInterpreterRequest ? true : false>(true);
// `executeCode` passes the caller's language string through, as it always
// has; AgentCore validates it against its enum. Every other field is the SDK's.
holds<
  Omit<Arm<'executeCode'>, 'arguments'> & {
    arguments: Omit<Arm<'executeCode'>['arguments'], 'language'> & {
      language?: ProgrammingLanguage;
    };
  } extends InvokeCodeInterpreterRequest
    ? true
    : false
>(true);

// READING — every field read off the stream exists in the SDK's answer, and
// the SDK's answer is assignable to what the drain reads, member for member.
type ResultRead = NonNullable<CodeInterpreterStreamOutputLike['result']>;
type BlockRead = NonNullable<ResultRead['content']>[number];
type StructuredRead = NonNullable<ResultRead['structuredContent']>;
holds<Exclude<keyof CodeInterpreterStreamOutputLike, StreamMemberKey> extends never ? true : false>(
  true,
);
holds<KeysWithin<ResultRead, CodeInterpreterResult>>(true);
holds<KeysWithin<BlockRead, ContentBlock>>(true);
holds<KeysWithin<StructuredRead, ToolResultStructuredContent>>(true);
holds<KeysWithin<AgentCoreResource, ResourceContent>>(true);
holds<ResourceContent extends AgentCoreResource ? true : false>(true);
holds<CodeInterpreterStreamOutput extends CodeInterpreterStreamOutputLike ? true : false>(true);

describe('the AgentCore Code Interpreter shapes, held to the SDK', () => {
  it('compiles — the checks above are the test; this names what they hold', () => {
    // A file entry is TEXT or BYTES, never both: the SDK block allows both
    // fields, and the adapter's own type is narrower on purpose.
    const text: AgentCoreFileContent = { path: 'a.csv', text: 'x' };
    const bytes: AgentCoreFileContent = { path: 'a.png', blob: new Uint8Array([1]) };
    // @ts-expect-error — a file entry with BOTH text and blob is not one this adapter builds.
    const both: AgentCoreFileContent = { path: 'a', text: 'x', blob: new Uint8Array([1]) };
    void both;
    expect([text, bytes].map((entry) => Object.keys(entry).sort())).toEqual([
      ['path', 'text'],
      ['blob', 'path'],
    ]);
  });
});
