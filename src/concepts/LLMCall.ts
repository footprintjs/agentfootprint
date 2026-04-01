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

import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { FlowChart as FlowChartType } from 'footprintjs';
import { annotateSpecIcons } from './specIcons';
import { agentScopeFactory } from '../executor/scopeFactory';

import type { LLMProvider, LLMResponse, Message } from '../types';
import { getTextContent } from '../types/content';
import { userMessage, systemMessage, ADAPTER_PATHS } from '../types';
import { AgentScope } from '../scope';
import { createCallLLMStage } from '../stages/callLLM';
import { parseResponseStage } from '../stages/parseResponse';
import { finalizeStage } from '../stages/finalize';
import { lastAssistantMessage } from '../memory';
import type { ScopeFacade } from 'footprintjs/advanced';
import type { AgentRecorder } from '../core';
import { RecorderBridge } from '../recorders/v2/RecorderBridge';

export interface LLMCallOptions {
  readonly provider: LLMProvider;
}

export class LLMCall {
  private readonly provider: LLMProvider;
  private sysPrompt?: string;
  private readonly recorders: AgentRecorder[] = [];

  private constructor(options: LLMCallOptions) {
    this.provider = options.provider;
  }

  static create(options: LLMCallOptions): LLMCall {
    return new LLMCall(options);
  }

  system(prompt: string): this {
    this.sysPrompt = prompt;
    return this;
  }

  /** Attach an AgentRecorder to observe execution events. */
  recorder(rec: AgentRecorder): this {
    this.recorders.push(rec);
    return this;
  }

  build(): LLMCallRunner {
    return new LLMCallRunner(this.provider, this.sysPrompt, [...this.recorders]);
  }
}

export class LLMCallRunner {
  private readonly provider: LLMProvider;
  private readonly sysPrompt?: string;
  private readonly recorders: AgentRecorder[];
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;

  constructor(provider: LLMProvider, sysPrompt?: string, recorders: AgentRecorder[] = []) {
    this.provider = provider;
    this.sysPrompt = sysPrompt;
    this.recorders = recorders;
  }

  /** Expose the internal flowChart for subflow composition. */
  toFlowChart(): FlowChartType {
    return this.buildChart('');
  }

  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<{ content: string; messages: Message[] }> {
    const chart = this.buildChart(message);
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;

    bridge?.dispatchTurnStart(message);

    const executor = new FlowChartExecutor(chart, { scopeFactory: agentScopeFactory });
    executor.enableNarrative();
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

    // Dispatch LLM call event from the adapter response stored in scope
    if (bridge) {
      const response = state[ADAPTER_PATHS.RESPONSE] as LLMResponse | undefined;
      if (response) {
        bridge.dispatchLLMCall(response, Date.now() - startMs);
      }
      bridge.dispatchTurnComplete(content, messages.length);
    }

    return { content, messages };
  }

  private buildChart(message: string): FlowChartType {
    const sysPrompt = this.sysPrompt;

    // API slot: SystemPrompt — set the system instruction
    const systemPromptStage = (scope: ScopeFacade) => {
      if (sysPrompt) {
        AgentScope.setSystemPrompt(scope, sysPrompt);
      }
    };

    // API slot: Messages — prepare the conversation messages
    const messagesStage = (scope: ScopeFacade) => {
      const msgs: Message[] = [];
      const sp = AgentScope.getSystemPrompt(scope);
      if (sp) msgs.push(systemMessage(sp));
      msgs.push(userMessage(message));
      AgentScope.setMessages(scope, msgs);
    };

    const callLLM = createCallLLMStage(this.provider);

    const builder = flowChart('SystemPrompt', systemPromptStage, 'system-prompt')
      .addFunction('Messages', messagesStage, 'messages')
      .addFunction('CallLLM', callLLM, 'call-llm')
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
