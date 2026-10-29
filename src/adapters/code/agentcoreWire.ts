/**
 * What `agentCoreCodeRunner` has to know about AgentCore's wire, as pure
 * functions: how big a request is, how a returned file is paired with the
 * path asked for, how the staged-input manifest reaches a runtime that has no
 * environment parameter, and which service errors mean the session is gone.
 *
 * Kept apart from the session so each rule is one small function with its
 * own test, and so the session reads as the sequence it is.
 */

import { STAGED_INPUTS_ENV } from '../../provider-contract/types.js';
import type { CodeFile } from '../../provider-contract/types.js';
import { CodeSandboxError } from '../../provider-contract/codeSandbox.js';
import type {
  AgentCoreFileContent,
  AgentCoreInvokeAnswer,
  AgentCoreInvokeInput,
} from './agentcoreClient.js';
import { isHighSurrogate, isLowSurrogate, payloadBytes } from './output.js';

// ── Request size ─────────────────────────────────────────────────────────

/**
 * AgentCore's per-call limit for `InvokeCodeInterpreter`: "Max payload size —
 * 100 MB — Maximum size for request/response payloads", not adjustable
 * (AgentCore Code Interpreter service quotas).
 *
 * The service does not say whether that MB is 10^6 or 2^20 bytes, so the
 * adapter holds a request to the SMALLER reading: a request it sends is never
 * one the limit could refuse on size, and one between the two readings is
 * refused here by name rather than by the service in words nobody can act on.
 */
export const AGENTCORE_MAX_REQUEST_BYTES = 100_000_000;

/** `{"arguments":{"content":[` … `]},"name":"writeFiles"}` around the entries. */
const WRITE_FILES_ENVELOPE_BYTES = JSON.stringify({
  arguments: { content: [] },
  name: 'writeFiles',
}).length;

/**
 * The size, in bytes, of the JSON body one `writeFiles` request sends —
 * computed, not built: text as its JSON-escaped UTF-8, bytes as base64 (how
 * the JSON protocol carries a blob), plus the envelope. Building the body to
 * measure it would hold a second copy of up to a hundred megabytes.
 */
export function writeFilesRequestBytes(content: readonly AgentCoreFileContent[]): number {
  let bytes = WRITE_FILES_ENVELOPE_BYTES + Math.max(content.length - 1, 0); // the commas
  for (const entry of content) {
    bytes += '{"path":'.length + jsonStringBytes(entry.path) + '}'.length;
    if (entry.text !== undefined) bytes += ',"text":'.length + jsonStringBytes(entry.text);
    else bytes += ',"blob":'.length + 2 + base64Length(entry.blob.byteLength);
  }
  return bytes;
}

/** Bytes of `JSON.stringify(text)` encoded as UTF-8, quotes included, without building it. */
export function jsonStringBytes(text: string): number {
  let bytes = 2;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 0x22 || unit === 0x5c) bytes += 2; // \" and \\
    else if (unit < 0x20) bytes += SHORT_ESCAPES.has(unit) ? 2 : 6; // \n … or \u00XX
    else if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else if (isHighSurrogate(unit) || isLowSurrogate(unit)) bytes += 6; // a lone half: \udXXX
    else bytes += 3;
  }
  return bytes;
}

/** Control characters JSON writes as a two-character escape: \b \t \n \f \r. */
const SHORT_ESCAPES: ReadonlySet<number> = new Set([0x08, 0x09, 0x0a, 0x0c, 0x0d]);

function base64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

/** One `writeFiles` entry for a payload: TEXT for a string, BYTES for bytes. */
export function fileContent(path: string, data: string | Uint8Array): AgentCoreFileContent {
  return typeof data === 'string' ? { path, text: data } : { path, blob: data };
}

// ── Reading a file back ──────────────────────────────────────────────────

/** How AgentCore names a file it returns: `file:///` + the path asked for
 *  (read from a real `readFiles` answer: `report.csv` → `file:///report.csv`). */
const FILE_URI_PREFIX = 'file:///';

/**
 * The one file a `readFiles` answer returned for `path` — or a refusal.
 *
 * Paired by the URI the SERVICE put on the file, never by position: a file
 * with no URI, or a URI naming another path, fails closed, and so does an
 * answer carrying several files for one path. Text or bytes is read off which
 * field the service filled — never off the file's name — and an entry with
 * both, or neither, is refused. A file over `maxBytes` is refused whole.
 */
export function pairReadFile(
  path: string,
  answer: AgentCoreInvokeAnswer,
  maxBytes: number,
): CodeFile {
  const refuse = (
    reason: ConstructorParameters<typeof CodeSandboxError>[0],
    why: string,
  ): never => {
    throw new CodeSandboxError(reason, `agentCoreCodeRunner: reading '${path}' — ${why}`, { path });
  };
  if (answer.isError === true) {
    refuse(
      'file-not-returned',
      'the service flagged its answer as an error, so no file came back. Its words are not ' +
        'repeated here.',
    );
  }
  const resources = answer.resources ?? [];
  if (resources.length === 0) refuse('file-not-returned', 'the answer held no file.');
  for (const resource of resources) {
    if (typeof resource.uri !== 'string' || resource.uri.length === 0) {
      refuse(
        'uri-missing',
        'a file came back without a URI, so it cannot be paired with the path asked for.',
      );
    }
    if (!uriNames(resource.uri as string, path)) {
      refuse('uri-mismatch', 'a file came back under a URI that names another path.');
    }
  }
  if (resources.length > 1)
    refuse('content-ambiguous', `${resources.length} files came back for one path.`);
  const resource = resources[0] as NonNullable<(typeof resources)[number]>;
  const hasText = resource.text !== undefined && resource.text !== null;
  const hasBlob = resource.blob !== undefined && resource.blob !== null;
  if (hasText === hasBlob) {
    refuse(
      'content-ambiguous',
      hasText
        ? 'the file came back as both text and bytes.'
        : 'the file came back with neither text nor bytes.',
    );
  }
  if (hasText && typeof resource.text !== 'string')
    refuse('content-ambiguous', 'its text is not a string.');
  if (hasBlob && !isBytes(resource.blob)) refuse('content-ambiguous', 'its bytes are not bytes.');
  const data = hasText ? (resource.text as string) : (resource.blob as Uint8Array);
  const bytes = payloadBytes(data);
  if (bytes > maxBytes) {
    throw new CodeSandboxError(
      'file-too-large',
      `agentCoreCodeRunner: '${path}' is ${bytes} bytes and this read allows ${maxBytes}. ` +
        'Nothing was returned — a file is never handed back cut.',
      { path, bytes, limit: maxBytes },
    );
  }
  return {
    path,
    data,
    bytes,
    ...(typeof resource.mimeType === 'string' &&
      resource.mimeType.length > 0 && {
        mediaType: resource.mimeType,
      }),
  };
}

/**
 * Does `uri` name `path`? Under ONE reading of the URI, never whichever of two
 * happens to match: when it holds valid percent escapes it is read decoded
 * (`my%20report.csv` is `my report.csv`), and only when it holds none — or
 * holds a `%` that is not an escape — is it read as written. So a request for
 * a file literally named `a%41.csv` is never answered by a URI that, decoded,
 * names `aA.csv`.
 */
export function uriNames(uri: string, path: string): boolean {
  if (!uri.startsWith(FILE_URI_PREFIX)) return false;
  const named = uri.slice(FILE_URI_PREFIX.length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(named);
  } catch {
    return named === path;
  }
  return decoded === path;
}

function isBytes(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array || Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

// ── The staged-input manifest ────────────────────────────────────────────

/** Where staged inputs land, relative to the session's working directory. */
export const STAGED_INPUTS_DIR = 'af-staged-inputs';

/** The line the manifest setup prints once the variable is set. */
export const MANIFEST_SET_MARKER = 'af-staged-inputs-set';

/** The runtimes whose environment the adapter knows how to set. */
export type ManifestRuntime = 'python' | 'javascript' | 'typescript';

/**
 * Which runtime a language names, for the manifest setup. `undefined` (no
 * language sent) is the service's default runtime, Python; a language this
 * adapter does not know is `undefined` — and refused, never guessed.
 */
export function manifestRuntime(language: string | undefined): ManifestRuntime | undefined {
  if (language === undefined || language === '') return 'python';
  const lower = language.toLowerCase();
  if (lower === 'python' || lower === 'python3' || lower === 'py') return 'python';
  if (lower === 'javascript' || lower === 'js' || lower === 'node') return 'javascript';
  if (lower === 'typescript' || lower === 'ts') return 'typescript';
  return undefined;
}

/**
 * The code that sets {@link STAGED_INPUTS_ENV} inside one runtime of the
 * session, then prints {@link MANIFEST_SET_MARKER}.
 *
 * WHY A SEPARATE CALL. `executeCode` takes no environment, and prepending a
 * line to the caller's code would shift every line number its traceback
 * reports and break a Python `from __future__` import. The session's runtime
 * keeps its state between executions, so the variable is set once per
 * runtime and manifest, by this code, before the caller's code runs.
 *
 * The value is the manifest JSON as a JSON string literal, which is a valid
 * string literal in Python and in JavaScript alike.
 */
export function manifestSetupCode(runtime: ManifestRuntime, manifestJson: string): string {
  const value = JSON.stringify(manifestJson);
  const name = JSON.stringify(STAGED_INPUTS_ENV);
  const marker = JSON.stringify(MANIFEST_SET_MARKER);
  if (runtime === 'python') {
    return [
      'import os as _af_os',
      `_af_os.environ[${name}] = ${value}`,
      'del _af_os',
      `print(${marker})`,
    ].join('\n');
  }
  return [
    '{',
    runtime === 'typescript'
      ? '  const _afHost: any = globalThis;'
      : '  const _afHost = globalThis;',
    `  const _afValue = ${value};`,
    '  if (_afHost.process && _afHost.process.env) {',
    `    _afHost.process.env[${name}] = _afValue;`,
    '  } else {',
    `    _afHost.Deno.env.set(${name}, _afValue);`,
    '  }',
    `  console.log(${marker});`,
    '}',
  ].join('\n');
}

/**
 * `command`, with {@link STAGED_INPUTS_ENV} exported ahead of it.
 *
 * A command is its own shell process, so a variable set in a code runtime
 * never reaches it; this line does, every time, and needs no state. The value
 * is single-quoted, the one shell quoting with no expansions inside it.
 */
export function withManifestExport(command: string, manifestJson: string): string {
  return `export ${STAGED_INPUTS_ENV}=${shellQuoted(manifestJson)}\n${command}`;
}

function shellQuoted(text: string): string {
  return `'${text.split("'").join(`'\\''`)}'`;
}

// ── Service errors ───────────────────────────────────────────────────────

/** The exceptions AgentCore models for `InvokeCodeInterpreter`, by class name. */
const MODELLED_EXCEPTIONS: ReadonlySet<string> = new Set([
  'AccessDeniedException',
  'ConflictException',
  'InternalServerException',
  'ResourceNotFoundException',
  'ServiceQuotaExceededException',
  'ThrottlingException',
  'ValidationException',
]);

/** Words a service uses for a session that is gone — both halves required, so
 *  a validation message that merely echoes a request containing "inactive"
 *  is not read as a dead session. */
const SAYS_INACTIVE = /\bnot active\b|\binactive\b/i;
const NAMES_A_SESSION = /\bsession\b/i;

/**
 * When `err` means the session itself is gone, the service's name for the
 * signal that said so; otherwise `undefined`.
 *
 * Three forms, all from AgentCore, whether thrown by the SDK or carried as a
 * stream member: a `ResourceNotFoundException` (on a session that started, the
 * missing resource is the session), and any modelled exception — a
 * `ValidationException` above all — whose words name a session and say it is
 * "not active" or "inactive".
 */
export function sessionExpiryEvidence(err: unknown): string | undefined {
  const name = errorName(err);
  if (name === 'ResourceNotFoundException') return name;
  const message = errorMessage(err);
  if (
    MODELLED_EXCEPTIONS.has(name) &&
    SAYS_INACTIVE.test(message) &&
    NAMES_A_SESSION.test(message)
  ) {
    return name;
  }
  return undefined;
}

/**
 * A modelled service exception from a file or command call, rewritten in
 * fixed words that name the exception and the call — or `undefined` for any
 * other error, which passes through as it is.
 *
 * The service's own message is NOT repeated: a validation message can quote
 * what was sent, and what was sent here is a path, a command or a file's
 * bytes. The exception's name is kept as the error's `name`, so a caller
 * branches on it exactly as on the SDK's own error.
 */
export function serviceRefusal(
  err: unknown,
  tool: AgentCoreInvokeInput['name'],
): Error | undefined {
  const name = errorName(err);
  if (!MODELLED_EXCEPTIONS.has(name)) return undefined;
  const refusal = new Error(
    `agentCoreCodeRunner: the service refused ${tool} (${name}). Its message is not repeated ` +
      'here, because it can quote what was sent.',
  );
  refusal.name = name;
  return refusal;
}

function errorName(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : '';
}

function errorMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}
