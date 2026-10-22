import type { BedrockCacheUsage } from './bedrockCacheWire.js';

/**
 * ConverseStream event shapes we consume.
 *
 * Note the asymmetry with the non-streaming API: `toolUse.input` is a
 * fully-formed OBJECT on a Converse response, but a JSON **string
 * fragment** on a ConverseStream delta. Fragments arrive across many
 * events and must be joined before parsing, and blocks are addressed by
 * `contentBlockIndex` because parallel tool calls interleave.
 */
export interface BedrockStreamEvent {
  contentBlockStart?: {
    contentBlockIndex?: number;
    start?: { toolUse?: { toolUseId?: string; name?: string } };
  };
  contentBlockDelta?: {
    contentBlockIndex?: number;
    delta?: {
      text?: string;
      toolUse?: { input?: string };
      reasoningContent?: { text?: string; signature?: string; redactedContent?: Uint8Array };
    };
  };
  contentBlockStop?: { contentBlockIndex?: number };
  messageStop?: { stopReason?: string };
  metadata?: { usage?: BedrockCacheUsage };
  // Many other event shapes exist; we ignore the ones not needed here.
}
