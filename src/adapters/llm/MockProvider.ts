/**
 * MockProvider — deterministic LLMProvider for tests + examples.
 *
 * Pattern: Adapter (GoF, Design Patterns ch. 4).
 * Role:    Ports-and-Adapters outer ring (Cockburn, 2005) — implements the
 *          LLMProvider port without calling out to a real LLM service.
 * Emits:   N/A (adapters don't emit; recorders observe them).
 */

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../types.js';

export interface MockProviderOptions {
  readonly name?: string;
  /** Fixed response content. Overrides `respond` when set. */
  readonly reply?: string;
  /**
   * Function that generates a reply from the request. Defaults to echoing
   * the last user message.
   */
  readonly respond?: (req: LLMRequest) => string;
  /** Simulated wall-clock delay per request (ms). Default 0. */
  readonly delayMs?: number;
  /** Fixed stop reason to return. Default 'stop'. */
  readonly stopReason?: string;
  /** Override usage counts returned. Default: chars/4 heuristic. */
  readonly usage?: Readonly<{
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  }>;
}

export class MockProvider implements LLMProvider {
  readonly name: string;
  private readonly reply?: string;
  private readonly respond: (req: LLMRequest) => string;
  private readonly delayMs: number;
  private readonly stopReason: string;
  private readonly usageOverride: MockProviderOptions['usage'];

  constructor(options: MockProviderOptions = {}) {
    this.name = options.name ?? 'mock';
    this.reply = options.reply;
    this.respond =
      options.respond ??
      ((req) => {
        const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
        return lastUser ? `echo: ${lastUser.content}` : '';
      });
    this.delayMs = options.delayMs ?? 0;
    this.stopReason = options.stopReason ?? 'stop';
    this.usageOverride = options.usage;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    const content = this.reply ?? this.respond(req);
    const inputChars = messagesChars(req.messages) + (req.systemPrompt?.length ?? 0);
    const outputChars = content.length;
    return {
      content,
      toolCalls: [],
      usage: {
        input: this.usageOverride?.input ?? Math.ceil(inputChars / 4),
        output: this.usageOverride?.output ?? Math.ceil(outputChars / 4),
        ...(this.usageOverride?.cacheRead !== undefined && {
          cacheRead: this.usageOverride.cacheRead,
        }),
        ...(this.usageOverride?.cacheWrite !== undefined && {
          cacheWrite: this.usageOverride.cacheWrite,
        }),
      },
      stopReason: this.stopReason,
    };
  }
}

function messagesChars(messages: LLMRequest['messages']): number {
  let n = 0;
  for (const m of messages) n += m.content.length;
  return n;
}
