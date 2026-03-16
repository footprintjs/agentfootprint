/**
 * Sample 16: Multi-modal Content — Images in LLM Conversations
 *
 * Shows how to send images alongside text to LLM providers.
 * Both Anthropic and OpenAI adapters handle image content blocks,
 * converting them to each provider's native format.
 *
 * Content model: agentfootprint uses a unified ContentBlock[] format.
 * Adapters convert to provider-specific representations:
 *   - Anthropic: { type: 'image', source: { type: 'base64', ... } }
 *   - OpenAI:    { type: 'image_url', image_url: { url: 'data:...' } }
 *   - Bedrock:   { image: { format, source: { bytes } } }
 */
import { describe, it, expect } from 'vitest';
import { textBlock, base64Image, urlImage, userMessage } from '../../src/types';
import { AnthropicAdapter, OpenAIAdapter } from '../../src/adapters';

// ── Test Helpers ────────────────────────────────────────────

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function captureAnthropicClient() {
  let captured: Record<string, unknown> | undefined;
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        captured = params;
        return {
          id: 'msg_mock',
          model: 'claude-sonnet-4-20250514',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'I see a 1x1 red pixel.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 10 },
        };
      },
    },
  };
  return { client, getParams: () => captured };
}

function captureOpenAIClient() {
  let captured: Record<string, unknown> | undefined;
  const client = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          captured = params;
          return {
            id: 'chatcmpl-mock',
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'I see a tiny image.' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
          };
        },
      },
    },
  };
  return { client, getParams: () => captured };
}

describe('Sample 16: Multi-modal Content', () => {
  // ── Content Block Factories ───────────────────────────────

  describe('content block helpers', () => {
    it('creates text blocks', () => {
      const block = textBlock('Hello world');
      expect(block).toEqual({ type: 'text', text: 'Hello world' });
    });

    it('creates base64 image blocks', () => {
      // base64Image(mediaType, data) → ImageBlock
      const block = base64Image('image/png', TINY_PNG_BASE64);
      expect(block).toEqual({
        type: 'image',
        source: { type: 'base64', mediaType: 'image/png', data: TINY_PNG_BASE64 },
      });
    });

    it('creates URL image blocks', () => {
      // urlImage(url) → ImageBlock
      const block = urlImage('https://example.com/photo.jpg');
      expect(block).toEqual({
        type: 'image',
        source: { type: 'url', url: 'https://example.com/photo.jpg' },
      });
    });
  });

  // ── Anthropic: Base64 images as content blocks ────────────

  describe('AnthropicAdapter — image content', () => {
    it('sends base64 images in Anthropic format', async () => {
      const { client, getParams } = captureAnthropicClient();
      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', _client: client });

      // Use ContentBlock[] with text + image
      const msg = userMessage([
        textBlock('What is in this image?'),
        base64Image('image/png', TINY_PNG_BASE64),
      ]);

      const result = await adapter.chat([msg]);
      expect(result.content).toBe('I see a 1x1 red pixel.');

      // Verify Anthropic received proper content blocks
      const params = getParams()!;
      const messages = params.messages as Array<{ content: unknown[] }>;
      const content = messages[0].content;
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' });
      expect(content[1]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_BASE64 },
      });
    });
  });

  // ── OpenAI: Images as image_url parts ─────────────────────

  describe('OpenAIAdapter — image content', () => {
    it('converts base64 images to data URLs', async () => {
      const { client, getParams } = captureOpenAIClient();
      const adapter = new OpenAIAdapter({ model: 'gpt-4o', _client: client });

      const msg = userMessage([
        textBlock('Describe this image'),
        base64Image('image/png', TINY_PNG_BASE64),
      ]);

      const result = await adapter.chat([msg]);
      expect(result.content).toBe('I see a tiny image.');

      // Verify OpenAI received image_url with data URI
      const params = getParams()!;
      const messages = params.messages as Array<{ content: unknown[] }>;
      const content = messages[0].content;
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: 'text', text: 'Describe this image' });
      expect(content[1]).toEqual({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` },
      });
    });

    it('passes URL images directly', async () => {
      const { client, getParams } = captureOpenAIClient();
      const adapter = new OpenAIAdapter({ model: 'gpt-4o', _client: client });

      const msg = userMessage([
        textBlock('What do you see?'),
        urlImage('https://example.com/photo.jpg'),
      ]);

      await adapter.chat([msg]);

      const params = getParams()!;
      const messages = params.messages as Array<{ content: unknown[] }>;
      const content = messages[0].content;
      expect(content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://example.com/photo.jpg' },
      });
    });
  });

  // ── Mixed content in conversations ────────────────────────

  describe('mixed text and image conversations', () => {
    it('handles multi-turn with images', async () => {
      const { client } = captureOpenAIClient();
      const adapter = new OpenAIAdapter({ model: 'gpt-4o', _client: client });

      const result = await adapter.chat([
        userMessage([
          textBlock('Look at this chart'),
          base64Image('image/png', TINY_PNG_BASE64),
        ]),
        userMessage('What trend do you see?'),
      ]);

      expect(result.content).toBe('I see a tiny image.');
    });
  });
});
