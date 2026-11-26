/** Request and history wire translation, including existing cache placement. */
import type { LLMMessage, LLMRequest, LLMToolSchema } from '../../../provider-contract/types.js';
import { UnsupportedThinkingError } from '../../../thinking/errors.js';
import { UnsupportedToolChoiceError } from '../../../provider-contract/forcedToolChoice.js';
import { anthropicTakesForcedToolChoice } from '../anthropicModels.js';
import { applyCacheMarkers, type BedrockMessagePosition } from '../bedrockCacheWire.js';
import type {
  BedrockConverseCommand,
  BedrockContentBlock,
  BedrockMessage,
  BedrockTool,
} from './types.js';

export function buildInput(
  req: LLMRequest,
  model: string,
  defaultMaxTokens: number,
): BedrockConverseCommand {
  // Converse accepts provider-specific thinking parameters, but enabling one
  // without carrying its signed reasoning through response/tool-result replay
  // would still break the conversation. Refuse this adapter's unsupported
  // intent before constructing a command on either transport path.
  if (req.thinking) {
    throw new UnsupportedThinkingError({
      provider: 'bedrock',
      model,
      reason: 'no-thinking',
      detail:
        'this Converse adapter does not implement thinking response and signed replay, so ' +
        '.thinking() cannot be honoured. Drop .thinking(), or use invokeModelGateway for ' +
        'a supported Claude Messages route through your gateway.',
    });
  }
  if (
    req.toolChoice !== undefined &&
    (req.tools?.length ?? 0) > 0 &&
    !anthropicTakesForcedToolChoice(model)
  ) {
    throw new UnsupportedToolChoiceError({ provider: 'bedrock', model });
  }
  const positions: (BedrockMessagePosition | undefined)[] = [];
  const input: BedrockConverseCommand = {
    modelId: model,
    messages: toBedrockMessages(req.messages, positions),
  };
  if (req.systemPrompt) input.system = [{ text: req.systemPrompt }];
  if (req.tools && req.tools.length > 0) {
    input.toolConfig = {
      tools: req.tools.map(toBedrockTool),
      // v7.26 — forced choice of one named tool. Nested inside the same guard
      // because `toolChoice` lives ON `toolConfig`: there is no place to put
      // it on a request that carries no tools.
      ...(req.toolChoice && { toolChoice: { tool: { name: req.toolChoice.name } } }),
    };
  }
  const inference: BedrockConverseCommand['inferenceConfig'] = {
    maxTokens: req.maxTokens ?? defaultMaxTokens,
  };
  if (req.temperature !== undefined) inference.temperature = req.temperature;
  if (req.stop && req.stop.length > 0) inference.stopSequences = [...req.stop];
  input.inferenceConfig = inference;
  if (req.cacheMarkers !== undefined) applyCacheMarkers(input, req.cacheMarkers, model, positions);
  return input;
}

function toBedrockMessages(
  messages: readonly LLMMessage[],
  positions: (BedrockMessagePosition | undefined)[],
): BedrockMessage[] {
  const result: BedrockMessage[] = [];
  for (const [messageIndex, m] of messages.entries()) {
    if (m.role === 'system') continue; // system goes in `system` field
    if (m.role === 'user') {
      result.push({ role: 'user', content: [{ text: m.content }] });
      positions[messageIndex] = { message: result.length - 1, content: 0 };
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: BedrockContentBlock[] = [];
      if (m.content) blocks.push({ text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          blocks.push({
            toolUse: { toolUseId: tc.id, name: tc.name, input: { ...tc.args } },
          });
        }
      }
      // An assistant turn with no text and no tool calls carries nothing, and
      // Converse refuses a blank text block — drop it, the same rule the
      // Anthropic wire keeps (`anthropicMessagesWire.ts` · `toAnthropicMessages`).
      if (blocks.length === 0) continue;
      result.push({ role: 'assistant', content: blocks });
      positions[messageIndex] = { message: result.length - 1, content: blocks.length - 1 };
      continue;
    }
    if (m.role === 'tool') {
      const block: BedrockContentBlock = {
        toolResult: {
          toolUseId: m.toolCallId ?? '',
          content: [{ text: m.content }],
        },
      };
      const last = result[result.length - 1];
      if (last && last.role === 'user') {
        last.content.push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
      positions[messageIndex] = {
        message: result.length - 1,
        content: result[result.length - 1].content.length - 1,
      };
      continue;
    }
  }
  return result;
}

function toBedrockTool(schema: LLMToolSchema): BedrockTool {
  return {
    toolSpec: {
      name: schema.name,
      description: schema.description,
      inputSchema: { json: { ...schema.inputSchema } },
    },
  };
}
