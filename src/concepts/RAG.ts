/**
 * RAG — Retrieve-Augment-Generate concept.
 *
 * Flowchart: Seed → Retrieve → AugmentPrompt → CallLLM → ParseResponse → Finalize
 *
 * Usage:
 *   const rag = RAG.create({ provider: mock([...]), retriever: mockRetriever([...]) })
 *     .system('You are helpful.')
 *     .topK(5)
 *     .build();
 *   const result = await rag.run('What is X?');
 */

import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { FlowChart as FlowChartType } from 'footprintjs';
import { annotateSpecIcons } from './specIcons';

import type {
  LLMProvider,
  LLMResponse,
  RetrieverProvider,
  RetrieveOptions,
  RetrievalResult,
  Message,
  RAGResult,
} from '../types';
import { getTextContent } from '../types/content';
import { userMessage, systemMessage, ADAPTER_PATHS } from '../types';
import type { AgentRecorder } from '../core';
import { RecorderBridge } from '../recorders/v2/RecorderBridge';
import { AgentScope } from '../scope';
import { createRetrieveStage } from '../stages/retrieve';
import { augmentPromptStage } from '../stages/augmentPrompt';
import { createCallLLMStage } from '../stages/callLLM';
import { parseResponseStage } from '../stages/parseResponse';
import { finalizeStage } from '../stages/finalize';
import { lastAssistantMessage } from '../memory';
import type { ScopeFacade } from 'footprintjs/advanced';
import { agentScopeFactory } from '../executor/scopeFactory';

export interface RAGOptions {
  readonly provider: LLMProvider;
  readonly retriever: RetrieverProvider;
}

export class RAG {
  private readonly provider: LLMProvider;
  private readonly retriever: RetrieverProvider;
  private sysPrompt?: string;
  private retrieveOptions: RetrieveOptions = {};
  private readonly recorders: AgentRecorder[] = [];

  private constructor(options: RAGOptions) {
    this.provider = options.provider;
    this.retriever = options.retriever;
  }

  static create(options: RAGOptions): RAG {
    return new RAG(options);
  }

  /** Set system prompt. */
  system(prompt: string): this {
    this.sysPrompt = prompt;
    return this;
  }

  /** Set number of chunks to retrieve. */
  topK(n: number): this {
    this.retrieveOptions = { ...this.retrieveOptions, topK: n };
    return this;
  }

  /** Set minimum relevance score threshold. */
  minScore(score: number): this {
    this.retrieveOptions = { ...this.retrieveOptions, minScore: score };
    return this;
  }

  /** Attach an AgentRecorder to observe execution events. */
  recorder(rec: AgentRecorder): this {
    this.recorders.push(rec);
    return this;
  }

  /** Build the RAG pipeline and return a runner. */
  build(): RAGRunner {
    return new RAGRunner(this.provider, this.retriever, this.sysPrompt, this.retrieveOptions, [...this.recorders]);
  }
}

export class RAGRunner {
  private readonly provider: LLMProvider;
  private readonly retriever: RetrieverProvider;
  private readonly sysPrompt?: string;
  private readonly retrieveOptions: RetrieveOptions;
  private readonly recorders: AgentRecorder[];
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;

  constructor(
    provider: LLMProvider,
    retriever: RetrieverProvider,
    sysPrompt: string | undefined,
    retrieveOptions: RetrieveOptions,
    recorders: AgentRecorder[] = [],
  ) {
    this.provider = provider;
    this.retriever = retriever;
    this.sysPrompt = sysPrompt;
    this.retrieveOptions = retrieveOptions;
    this.recorders = recorders;
  }

  /** Expose the internal flowChart for subflow composition. */
  toFlowChart(): FlowChartType {
    return this.buildChart('');
  }

  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<RAGResult> {
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
    const retrievalResult = state.retrievalResult as RetrievalResult | undefined;

    if (bridge) {
      const response = state[ADAPTER_PATHS.RESPONSE] as LLMResponse | undefined;
      if (response) {
        bridge.dispatchLLMCall(response, Date.now() - startMs);
      }
      bridge.dispatchTurnComplete(content, messages.length);
    }

    return {
      content,
      messages,
      chunks: retrievalResult?.chunks ?? [],
      query: retrievalResult?.query ?? message,
    };
  }

  private buildChart(message: string): FlowChartType {
    const sysPrompt = this.sysPrompt;

    const seedStage = (scope: ScopeFacade) => {
      const msgs: Message[] = [];
      if (sysPrompt) msgs.push(systemMessage(sysPrompt));
      msgs.push(userMessage(message));
      AgentScope.setMessages(scope, msgs);
    };

    const retrieve = createRetrieveStage(this.retriever, this.retrieveOptions);
    const callLLM = createCallLLMStage(this.provider);

    const builder = flowChart('Seed', seedStage, 'seed')
      .addFunction('Retrieve', retrieve, 'retrieve')
      .addFunction('AugmentPrompt', augmentPromptStage, 'augment-prompt')
      .addFunction('CallLLM', callLLM, 'call-llm')
      .addFunction('ParseResponse', parseResponseStage, 'parse-response')
      .addFunction('Finalize', finalizeStage, 'finalize');

    this.lastSpec = annotateSpecIcons(builder.toSpec());
    return builder.build();
  }

  /** Get the flowchart spec (stage graph metadata). */
  getSpec(): unknown {
    if (!this.lastSpec) {
      this.buildChart('');
    }
    return this.lastSpec;
  }

  /** Get the narrative from the last run. */
  getNarrative(): string[] {
    return this.lastExecutor?.getNarrative() ?? [];
  }

  /** Get structured narrative entries from the last run. */
  getNarrativeEntries() {
    return this.lastExecutor?.getNarrativeEntries() ?? [];
  }

  /** Get the full execution snapshot from the last run. */
  getSnapshot() {
    return this.lastExecutor?.getSnapshot();
  }
}
