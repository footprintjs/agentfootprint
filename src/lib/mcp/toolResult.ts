/** MCP result decoding; default text is unchanged, structured data is opt-in. */
import type { McpCallToolResult, McpClientOptions } from './types.js';

type ResultMode = NonNullable<McpClientOptions['resultMode']>;

/** Validate before opening a transport; a misspelled opt-in must not disappear. */
export function resultModeOf(value: unknown, name: string): ResultMode {
  if (value === undefined) return 'text';
  if (value === 'text' || value === 'structured' || value === 'structured-or-json') return value;
  throw new Error(`mcpClient[${name}]: resultMode must be 'text', 'structured' or 'structured-or-json'.`);
}

/** Internal shared decoder for the real connection and curated mock. */
export function readToolResult(result: McpCallToolResult, toolName: string, serverName: string,
  mode: ResultMode = 'text'): unknown {
  if (mode === 'text') return readTextResult(result, toolName, serverName);
  const prefix = `MCP tool '${toolName}' (server '${serverName}')`;
  const invalid = () => new Error(`${prefix} did not provide valid structuredContent. ` +
    (mode === 'structured-or-json' ? 'Expected a JSON object in structuredContent or, when absent, exactly one JSON-object text block. ' :
      'Expected a JSON object in structuredContent. ') +
    'Malformed, cyclic or over-limit data is refused; result data is not included in this error.');
  if (typeof result !== 'object' || result === null) throw invalid();
  // Error status belongs to the tool, even if it also returned a usable object
  // or a legacy arm. Never launder a failed call into successful data.
  let isError: unknown;
  try { isError = ownValue(result, 'isError'); } catch { throw invalid(); }
  if (isError === true) {
    const diagnostic = errorDiagnostic(result);
    throw new Error(diagnostic === undefined
      ? `${prefix} returned an error; its structured result was not read.`
      : `${prefix} returned an error: ${diagnostic}`);
  }
  try {
    const structured = Object.getOwnPropertyDescriptor(result, 'structuredContent');
    if (structured !== undefined) {
      if (!('value' in structured) || !jsonObject(structured.value)) throw invalid();
      return structured.value;
    }
    if (mode !== 'structured-or-json') throw invalid();
    const content = ownValue(result, 'content');
    if (!Array.isArray(content) || content.length !== 1) throw invalid();
    const block = ownValue(content, '0');
    if (typeof block !== 'object' || block === null || ownValue(block, 'type') !== 'text') throw invalid();
    const text = ownValue(block, 'text');
    if (typeof text !== 'string' || text.length > 16_000_000) throw invalid();
    const parsed: unknown = JSON.parse(text);
    if (!jsonObject(parsed)) throw invalid();
    return parsed;
  } catch {
    // Parser and getter exceptions may echo source bytes. Keep the refusal
    // authored here rather than forwarding arbitrary transport payloads.
    throw invalid();
  }
}

/** Tool-authored error text is corrective evidence, not a successful result.
 * Read only own data properties; never inspect structuredContent, invoke a
 * getter/toJSON or stringify a non-string diagnostic. Over-limit/malformed
 * diagnostics use the generic refusal rather than partial advice. */
function errorDiagnostic(result: object): string | undefined {
  try {
    const content = ownValue(result, 'content');
    if (!Array.isArray(content)) return undefined;
    const length = ownValue(content, 'length');
    if (typeof length !== 'number' || length < 1 || length > 32) return undefined;
    const texts: string[] = [];
    let chars = 0;
    for (let index = 0; index < length; index++) {
      const block = ownValue(content, String(index));
      if (typeof block !== 'object' || block === null || ownValue(block, 'type') !== 'text') return undefined;
      const text = ownValue(block, 'text');
      if (typeof text !== 'string') return undefined;
      chars += text.length + (index === 0 ? 0 : 1);
      if (chars > 8_192) return undefined;
      texts.push(text);
    }
    const diagnostic = texts.join('\n');
    return diagnostic.trim() ? diagnostic : undefined;
  } catch {
    return undefined;
  }
}

function ownValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor !== undefined && !('value' in descriptor)) throw new Error('Accessor is not JSON data');
  return descriptor?.value;
}

/** Validate the JSON data domain without invoking toJSON/getters, converting
 * unknown to null or dropping unsupported fields. No clone or normalization. */
function jsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const ancestors = new Set<object>();
  let visited = 0;
  function visit(item: unknown, depth: number): boolean {
    if (++visited > 1_000_000) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item !== 'object' || depth >= 64 || ancestors.has(item)) return false;
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    ancestors.add(item);
    try {
      const keys = Reflect.ownKeys(item);
      if (array && keys.length !== item.length + 1) return false;
      for (const key of keys) {
        if (array && key === 'length') continue;
        if (typeof key !== 'string') return false;
        if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !('value' in descriptor) || !visit(descriptor.value, depth + 1)) return false;
      }
      return true;
    } finally { ancestors.delete(item); }
  }
  return visit(value, 0);
}

// ─── Reading a tools/call answer (both arms of the protocol) ───────

/**
 * Turn a `tools/call` answer into the text the agent hands the model.
 *
 * Three cases, because the protocol has three and pretending otherwise is what
 * broke on a server that answered the old way:
 *
 *   1. **content blocks** — today's shape. Text blocks are concatenated;
 *      non-text blocks (images, resources) are summarized with their type.
 *      `isError: true` becomes a thrown tool error, exactly as before.
 *   2. **`toolResult`** — the 2024-10-07 shape, which carries no `content` and
 *      no `isError`. The value BECOMES the tool text: a string verbatim,
 *      anything else JSON-stringified. That conversion is stated here and in
 *      the docs rather than left to be inferred from a mangled answer.
 *   3. **neither** — a corrective error naming the SHAPE that arrived (its
 *      type, or its keys) and never the payload: an unrecognised answer is
 *      still somebody's data, and a tool error is read by the model.
 *
 * **Order matters, and here is why the legacy check runs first.** The SDK's
 * default result schema declares `content` with a default of `[]`, so a legacy
 * `{ toolResult }` payload arrives here wearing an empty `content` it never
 * sent. Reading that array first would answer a real result with an empty
 * string — the same silence in a friendlier coat. So a `toolResult` beside an
 * EMPTY `content` is read as the legacy answer it is. A NON-empty `content`
 * always wins: a server that sent blocks meant the blocks.
 */
function readTextResult(result: McpCallToolResult, toolName: string, serverName: string): string {
  if (isLegacyResult(result) && !hasNonEmptyContent(result)) {
    return stringifyLegacyResult(result.toolResult);
  }
  if (hasContentBlocks(result)) {
    const text = result.content
      .map((c) => (c.type === 'text' && c.text ? c.text : `[${c.type}]`))
      .join('\n');
    if (result.isError) {
      throw new Error(`MCP tool '${toolName}' (server '${serverName}') returned an error: ${text}`);
    }
    return text;
  }
  throw new Error(
    `MCP tool '${toolName}' (server '${serverName}') answered with a shape this client does ` +
      `not understand: ${describeShape(result)}. A tools/call result carries either 'content' ` +
      `blocks or a legacy 'toolResult'; this had neither.`,
  );
}

/**
 * The current arm. Checked on the wire value, not on the declared type — and
 * defensively, because a `null` or a scalar is exactly the kind of answer that
 * has to reach the corrective error rather than crash on the way to it.
 */
function hasContentBlocks(
  result: McpCallToolResult,
): result is Extract<McpCallToolResult, { content: unknown }> {
  return Array.isArray(contentOf(result));
}

/** Blocks the server actually sent, as opposed to the schema's default `[]`. */
function hasNonEmptyContent(result: McpCallToolResult): boolean {
  const content = contentOf(result);
  return Array.isArray(content) && content.length > 0;
}

function contentOf(result: McpCallToolResult): unknown {
  if (typeof result !== 'object' || result === null) return undefined;
  return (result as { content?: unknown }).content;
}

/** The 2024-10-07 arm — the key's PRESENCE is the signal; its value may be anything. */
function isLegacyResult(result: McpCallToolResult): result is { toolResult: unknown } {
  return typeof result === 'object' && result !== null && 'toolResult' in result;
}

/** A legacy `toolResult` as tool text: a string verbatim, anything else as JSON. */
function stringifyLegacyResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular or otherwise unserializable — say what we can rather than
    // throwing from a path whose whole job is to report an answer.
    return String(value);
  }
}

/** Name a value's SHAPE for an error message. Never its contents. */
function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length} item(s)`;
  if (typeof value !== 'object') return `a ${typeof value}`;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return 'an object with no keys';
  const shown = keys.slice(0, 8);
  return `an object with keys [${shown.join(', ')}${keys.length > shown.length ? ', …' : ''}]`;
}
