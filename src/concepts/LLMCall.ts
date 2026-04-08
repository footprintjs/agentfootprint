/**
 * LLMCall — simplest concept: single LLM call, no tools, no loop.
 *
 * Flowchart: SystemPrompt → Messages → CallLLM → ParseResponse → Finalize
 *
 * Usage:
 *   const caller = LLMCall.create({ provider: mock([{ content: 'Hi!' }]) })
 *     .system('You are helpful.')
 *     .build();
 *   const result = await caller.run('Hello');
 */

import { flowChart, FlowChartExecutor, MetricRecorder } from 'footprintjs';
import type { FlowChart as FlowChartType, FlowChartExecutorOptions, TypedScope } from 'footprintjs';
import { annotateSpecIcons } from './specIcons';

import type { LLMProvider, LLMResponse, Message } from '../types';
import type { ModelConfig } from '../models';
import { getTextContent } from '../types/content';
import { userMessage, systemMessage } from '../types';
import type { RAGState } from '../scope/types';
import { createCallLLMStage } from '../stages/callLLM';
import { parseResponseStage } from '../stages/parseResponse';
import { finalizeStage } from '../stages/finalize';
import { lastAssistantMessage } from '../memory';
import type { AgentRecorder } from '../core';
import { RecorderBridge } from '../recorders/v2/RecorderBridge';
import { resolveProvider } from '../adapters/createProvider';

export interface LLMCallOptions {
  /** LLMProvider instance or ModelConfig from anthropic()/openai()/bedrock()/ollama(). */
  readonly provider: LLMProvider | ModelConfig;
}

export class LLMCall {
  private readonly provider: LLMProvider;
  private sysPrompt?: string;
  private readonly recorders: AgentRecorder[] = [];
  private enableStreaming = false;

  private constructor(options: LLMCallOptions) {
    this.provider = resolveProvider(options.provider);
  }

  static create(options: LLMCallOptions): LLMCall {
    return new LLMCall(options);
  }

  system(prompt: string): this {
    this.sysPrompt = prompt;
    return this;
  }

  streaming(enabled: boolean): this {
    this.enableStreaming = enabled;
    return this;
  }

  /** Attach an AgentRecorder to observe execution events. */
  recorder(rec: AgentRecorder): this {
    this.recorders.push(rec);
    return this;
  }

  build(): LLMCallRunner {
    return new LLMCallRunner(
      this.provider,
      this.sysPrompt,
      [...this.recorders],
      this.enableStreaming,
    );
  }
}

export class LLMCallRunner {
  private readonly provider: LLMProvider;
  private readonly sysPrompt?: string;
  private readonly recorders: AgentRecorder[];
  private readonly streamingEnabled: boolean;
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;

  constructor(
    provider: LLMProvider,
    sysPrompt?: string,
    recorders: AgentRecorder[] = [],
    streaming = false,
  ) {
    this.provider = provider;
    this.sysPrompt = sysPrompt;
    this.recorders = recorders;
    this.streamingEnabled = streaming;
  }

  /** Expose the internal flowChart for subflow composition. */
  toFlowChart(): FlowChartType {
    return this.buildChart('');
  }

  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number; onToken?: (token: string) => void },
  ): Promise<{ content: string; messages: Message[] }> {
    const chart = this.buildChart(message);
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;

    bridge?.dispatchTurnStart(message);

    const executorOpts: FlowChartExecutorOptions = { enrichSnapshots: true };
    if (options?.onToken && this.streamingEnabled) {
      executorOpts.streamHandlers = {
        onToken: (_streamId: string, token: string) => options.onToken!(token),
        onStart: () => {},
        onEnd: () => {},
      };
    }
    const executor = new FlowChartExecutor(chart, executorOpts);
    executor.enableNarrative();
    executor.attachRecorder(new MetricRecorder('metrics'));
    const startMs = Date.now();

    try {
      await executor.run({
        input: { message },
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
      bridge?.dispatchError('llm', err);
      throw err;
    }
    this.lastExecutor = executor;

    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    const messages = (state.messages as Message[]) ?? [];
    const lastAsst = lastAssistantMessage(messages);
    const content = (state.result as string) ?? (lastAsst ? getTextContent(lastAsst.content) : '');

    // Dispatch LLM call event with evaluation context
    if (bridge) {
      const response = state.adapterRawResponse as LLMResponse | undefined;
      if (response) {
        bridge.dispatchLLMCall(response, Date.now() - startMs, {
          systemPrompt: state.systemPrompt as string | undefined,
          toolDescriptions: state.toolDescriptions as
            | Array<{ name: string; description: string }>
            | undefined,
          messages: messages as Array<{ role: string; content: unknown }>,
        });
      }
      bridge.dispatchTurnComplete(content, messages.length);
    }

    return { content, messages };
  }

  private buildChart(message: string): FlowChartType {
    const sysPrompt = this.sysPrompt;

    // API slot: SystemPrompt — set the system instruction
    const systemPromptStage = (scope: TypedScope<RAGState>) => {
      if (sysPrompt) {
        scope.systemPrompt = sysPrompt;
      }
    };

    // API slot: Messages — prepare the conversation messages
    const messagesStage = (scope: TypedScope<RAGState>) => {
      const msgs: Message[] = [];
      const sp = scope.systemPrompt;
      if (sp) msgs.push(systemMessage(sp));
      msgs.push(userMessage(message));
      scope.messages = msgs;
    };

    const callLLM = createCallLLMStage(this.provider);

    let builder = flowChart<RAGState>(
      'SystemPrompt',
      systemPromptStage,
      'system-prompt',
    ).addFunction('Messages', messagesStage, 'messages');

    if (this.streamingEnabled) {
      builder = builder.addStreamingFunction('CallLLM', callLLM, 'call-llm', 'llm-stream');
    } else {
      builder = builder.addFunction('CallLLM', callLLM, 'call-llm');
    }

    builder = builder
      .addFunction('ParseResponse', parseResponseStage, 'parse')
      .addFunction('Finalize', finalizeStage, 'finalize');

    this.lastSpec = annotateSpecIcons(builder.toSpec());
    return builder.build();
  }

  getSpec(): unknown {
    if (!this.lastSpec) {
      this.buildChart('');
    }
    return this.lastSpec;
  }

  getNarrative(): string[] {
    return this.lastExecutor?.getNarrative() ?? [];
  }

  getSnapshot() {
    return this.lastExecutor?.getSnapshot();
  }
}
