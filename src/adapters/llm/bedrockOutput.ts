import type { BedrockStreamEvent } from './bedrockWireTypes.js';
import type { LLMResponse } from '../../provider-contract/types.js';

/**
 * Honesty invariant: a response claiming `tool_use` with zero parsed tool
 * calls is self-contradictory — the model asked for tools and the adapter
 * lost them. Never return it quietly; throw so a configured `reliability`
 * rule (retry / fallback / fail-fast) can act instead of the agent
 * silently answering without running its tools.
 *
 * Post-7.6.1 this cannot happen on today's wire shapes — it is a tripwire
 * for future ConverseStream shape drift. Applied on BOTH the streaming and
 * non-streaming exits so the two paths can never drift apart again.
 */
export function ensureHonestToolUse(response: LLMResponse): LLMResponse {
  if (response.stopReason === 'tool_use' && response.toolCalls.length === 0) {
    throw Object.assign(
      new Error(
        "[bedrock] stopReason 'tool_use' with zero parsed tool calls — " +
          'tool-use blocks were lost (stream-shape drift?). ' +
          'Refusing to return a self-contradictory response.',
      ),
      { name: 'BedrockProviderError', code: 'BEDROCK_STREAM_TOOLUSE_LOST' },
    );
  }
  return response;
}

/**
 * Parse the joined JSON fragments of one streamed tool-use block.
 *
 * Empty (no-arg tools stream zero fragments, or a single `''`) → `{}`.
 * Malformed → a TYPED throw, never a silent `{}`: swallowing the failure
 * would execute a side-effecting tool with its arguments dropped, which is
 * the worst failure mode available. A thrown provider error reaches the
 * `reliability` / `withRetry` machinery, and a retry usually streams clean
 * JSON.
 *
 * The raw fragment bytes are deliberately NOT put in the message — tool
 * arguments can carry user data and provider error messages land in audit
 * logs unredacted. `rawLength` is reported instead.
 */
export function parseToolArgs(
  joined: string,
  toolName: string,
  toolUseId: string,
  contentBlockIndex: number,
): Record<string, unknown> {
  if (joined.trim().length === 0) return {};
  try {
    return JSON.parse(joined) as Record<string, unknown>;
  } catch (parseErr) {
    throw Object.assign(
      new Error(
        `[bedrock] malformed tool-use JSON for tool '${toolName}' (toolUseId ${toolUseId}): ` +
          `${(parseErr as Error).message}. Refusing to run the tool with dropped arguments.`,
      ),
      {
        name: 'BedrockProviderError',
        code: 'BEDROCK_MALFORMED_TOOL_ARGS',
        toolName,
        toolUseId,
        contentBlockIndex,
        rawLength: joined.length,
        cause: parseErr,
      },
    );
  }
}

export function normalizeStopReason(raw: string): string {
  switch (raw) {
    case 'end_turn':
      return 'stop';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'guardrail_intervened':
    case 'content_filtered':
      return 'content_filter';
    default:
      return raw;
  }
}

/** AWS examples include messageStart and an empty text delta. Neither is
 * evidence of generated content. Checked 2026-10-22:
 * https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html */
export function isBedrockOutputEvent(event: BedrockStreamEvent): boolean {
  const tool = event.contentBlockStart?.start?.toolUse;
  if (tool && (Boolean(tool.toolUseId) || Boolean(tool.name))) return true;
  const delta = event.contentBlockDelta?.delta;
  return Boolean(
    (delta &&
      Object.values(delta).some((value) =>
        typeof value === 'string'
          ? value.length > 0
          : typeof value === 'object' &&
            value !== null &&
            Object.values(value).some(
              (part) =>
                (typeof part === 'string' && part.length > 0) ||
                (part instanceof Uint8Array && part.byteLength > 0),
            ),
      )) ||
      (event.metadata?.usage?.outputTokens ?? 0) > 0,
  );
}
