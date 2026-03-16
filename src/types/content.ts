/**
 * Multi-modal content blocks for LLM messages.
 * Provider-agnostic — adapters translate to/from provider formats (Anthropic, OpenAI, etc.).
 *
 * Design: discriminated union on `type` field, like Anthropic's API.
 * Every message's `content` is `string | ContentBlock[]` — string for backward compat,
 * ContentBlock[] for multi-modal (images, tool use, structured results).
 */

// ── Content Blocks ──────────────────────────────────────────

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ImageBlock {
  readonly type: 'image';
  readonly source: ImageSource;
}

export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly toolUseId: string;
  readonly content: string | ContentBlock[];
  readonly isError?: boolean;
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

// ── Image Source ────────────────────────────────────────────

export interface Base64ImageSource {
  readonly type: 'base64';
  readonly mediaType: string;
  readonly data: string;
}

export interface UrlImageSource {
  readonly type: 'url';
  readonly url: string;
}

export type ImageSource = Base64ImageSource | UrlImageSource;

// ── MessageContent ──────────────────────────────────────────

/** Content of a message — plain string (backward compat) or structured blocks. */
export type MessageContent = string | ContentBlock[];

// ── Stream Callback ─────────────────────────────────────────

/**
 * Callback for streaming LLM responses token-by-token.
 * Passed through provider interfaces so consumers can receive
 * incremental output without waiting for the full response.
 */
export type StreamCallback = (chunk: StreamChunk) => void;

export interface StreamChunk {
  readonly type: 'text' | 'tool_use_start' | 'tool_use_input' | 'done';
  /** Text delta (for type: 'text'). */
  readonly text?: string;
  /** Tool call being streamed (for type: 'tool_use_start'). */
  readonly toolUseId?: string;
  /** Tool name (for type: 'tool_use_start'). */
  readonly toolName?: string;
  /** Partial JSON input (for type: 'tool_use_input'). */
  readonly partialInput?: string;
}

// ── Factory Functions ───────────────────────────────────────

export function textBlock(text: string): TextBlock {
  return { type: 'text', text };
}

export function imageBlock(source: ImageSource): ImageBlock {
  return { type: 'image', source };
}

export function base64Image(mediaType: string, data: string): ImageBlock {
  return { type: 'image', source: { type: 'base64', mediaType, data } };
}

export function urlImage(url: string): ImageBlock {
  return { type: 'image', source: { type: 'url', url } };
}

export function toolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown>,
): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

export function toolResultBlock(
  toolUseId: string,
  content: string | ContentBlock[],
  isError?: boolean,
): ToolResultBlock {
  return { type: 'tool_result', toolUseId, content, isError };
}

// ── ToolCall ↔ ToolUseBlock Conversion ──────────────────────

/**
 * Convert a legacy ToolCall (from AssistantMessage.toolCalls) to a ToolUseBlock.
 * Bridges the two representations: ToolCall uses `arguments`, ToolUseBlock uses `input`.
 */
export function toolCallToBlock(call: {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}): ToolUseBlock {
  return { type: 'tool_use', id: call.id, name: call.name, input: call.arguments };
}

/**
 * Convert a ToolUseBlock to a legacy ToolCall format.
 * Bridges the two representations: ToolUseBlock uses `input`, ToolCall uses `arguments`.
 */
export function blockToToolCall(block: ToolUseBlock): {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
} {
  return { id: block.id, name: block.name, arguments: block.input };
}

// ── Content Helpers ─────────────────────────────────────────

/**
 * Extract text from message content, regardless of form.
 * - string → returned as-is
 * - ContentBlock[] → concatenates all TextBlock.text values
 *
 * Use this instead of `msg.content.length` or string operations on content.
 */
export function getTextContent(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/**
 * Get the character length of message content (for budget calculations).
 * Handles both string and ContentBlock[] forms.
 */
export function contentLength(content: MessageContent): number {
  return getTextContent(content).length;
}

/**
 * Check if content contains any tool use blocks.
 */
export function hasToolUseBlocks(content: MessageContent): boolean {
  if (typeof content === 'string') return false;
  return content.some((block) => block.type === 'tool_use');
}

/**
 * Extract tool use blocks from content.
 */
export function getToolUseBlocks(content: MessageContent): ToolUseBlock[] {
  if (typeof content === 'string') return [];
  return content.filter((block): block is ToolUseBlock => block.type === 'tool_use');
}
