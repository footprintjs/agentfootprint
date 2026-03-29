/**
 * Creates a 3-stage adapter subflow (FormatRequest → ExecuteCall → MapResponse).
 *
 * This is the key architectural insight: the adapter is a FlowChart subflow.
 * Swapping mock for real only changes the ExecuteCall stage.
 * The rest of the agent flowchart runs identically.
 */

import { flowChart } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';

import type { LLMProvider, LLMToolDescription, Message } from '../types';
import { ADAPTER_PATHS } from '../types';
import { normalizeAdapterResponse } from '../stages/helpers';

export interface AdapterSubflowConfig {
  /** The LLM provider (real or mock). */
  readonly provider: LLMProvider;
  /** Adapter ID for narrative. */
  readonly id?: string;
}

/**
 * Build a 3-stage subflow for LLM calls.
 *
 * Stage 1 (FormatRequest): Read messages + tools from scope → write adapter request
 * Stage 2 (ExecuteCall): Call provider.chat() → write raw response
 * Stage 3 (MapResponse): Normalize to AdapterResult → write result
 */
export function createAdapterSubflow(config: AdapterSubflowConfig) {
  const adapterId = config.id ?? 'llm-adapter';

  const formatRequest = (scope: ScopeFacade) => {
    const messages = scope.getValue('messages') as Message[] | undefined;
    const tools = scope.getValue('toolDescriptions') as LLMToolDescription[] | undefined;

    if (!messages || messages.length === 0) {
      throw new Error('AdapterSubflow: no messages in scope');
    }

    scope.setValue(ADAPTER_PATHS.REQUEST, {
      messages,
      tools: tools ?? [],
    });
  };

  const executeCall = async (scope: ScopeFacade) => {
    const request = scope.getValue(ADAPTER_PATHS.REQUEST) as {
      messages: Message[];
      tools: LLMToolDescription[];
    };

    const options = request.tools.length > 0 ? { tools: request.tools } : undefined;
    const response = await config.provider.chat(request.messages, options);

    scope.setValue(ADAPTER_PATHS.RESPONSE, response);
  };

  const mapResponse = (scope: ScopeFacade) => {
    const response = scope.getValue(ADAPTER_PATHS.RESPONSE) as {
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      usage?: { inputTokens: number; outputTokens: number };
      model?: string;
    };

    scope.setValue(ADAPTER_PATHS.RESULT, normalizeAdapterResponse(response));
  };

  return flowChart('FormatRequest', formatRequest, `${adapterId}-format`)
    .addFunction('ExecuteCall', executeCall, `${adapterId}-call`)
    .addFunction('MapResponse', mapResponse, `${adapterId}-map`)
    .build();
}
