/**
 * Creates a 3-stage adapter subflow (FormatRequest → ExecuteCall → MapResponse).
 *
 * This is the key architectural insight: the adapter is a FlowChart subflow.
 * Swapping mock for real only changes the ExecuteCall stage.
 * The rest of the agent flowchart runs identically.
 */

import { flowChart } from 'footprintjs';
import type { TypedScope } from 'footprintjs';

import type {
  LLMProvider,
  LLMToolDescription,
  LLMResponse,
  Message,
  AdapterResult,
} from '../types';
import { normalizeAdapterResponse } from '../stages/helpers';

export interface AdapterSubflowConfig {
  /** The LLM provider (real or mock). */
  readonly provider: LLMProvider;
  /** Adapter ID for narrative. */
  readonly id?: string;
}

/** Internal state shape for the adapter subflow. */
interface AdapterSubflowState {
  messages: Message[];
  toolDescriptions: LLMToolDescription[];
  adapterRequest: { messages: Message[]; tools: LLMToolDescription[] };
  adapterRawResponse: LLMResponse;
  adapterResult: AdapterResult;
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

  const formatRequest = (scope: TypedScope<AdapterSubflowState>) => {
    const messages = scope.messages;
    const tools = scope.toolDescriptions ?? [];

    if (!messages || messages.length === 0) {
      throw new Error('AdapterSubflow: no messages in scope');
    }

    scope.adapterRequest = { messages, tools };
  };

  const executeCall = async (scope: TypedScope<AdapterSubflowState>) => {
    const request = scope.adapterRequest;

    const options = request.tools.length > 0 ? { tools: request.tools } : undefined;
    const response = await config.provider.chat(request.messages, options);

    scope.adapterRawResponse = response;
  };

  const mapResponse = (scope: TypedScope<AdapterSubflowState>) => {
    const response = scope.adapterRawResponse;
    scope.adapterResult = normalizeAdapterResponse(response);
  };

  return flowChart<AdapterSubflowState>('FormatRequest', formatRequest, `${adapterId}-format`)
    .addFunction('ExecuteCall', executeCall, `${adapterId}-call`)
    .addFunction('MapResponse', mapResponse, `${adapterId}-map`)
    .build();
}
