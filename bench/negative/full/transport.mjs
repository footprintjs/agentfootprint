/** Anthropic wire shared by agent and raters. No hidden SDK retries, caching changes, or paid probes. */
import { randomUUID } from 'node:crypto';
import { requestBound } from './budget.mjs';

async function post(path, body, { signal, fetchImpl = fetch } = {}) {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error('ANTHROPIC_API_KEY is required in the environment.');
  const response = await fetchImpl(`https://api.anthropic.com/v1/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error(`Anthropic ${path} HTTP ${response.status}; no automatic retry.`);
  return response.json();
}

export function countingBody(params) {
  const { model, system, messages, tools, tool_choice, thinking, output_config } = params;
  return {
    model,
    ...(system && { system }),
    messages,
    ...(tools?.length && { tools }),
    ...(tool_choice && { tool_choice }),
    ...(thinking && { thinking }),
    ...(output_config && { output_config }),
  };
}

export async function countRequest(params, options) {
  const body = await post('messages/count_tokens', countingBody(params), options);
  if (!Number.isSafeInteger(body.input_tokens) || body.input_tokens < 0)
    throw new Error('Token counter returned no usable count.');
  return body.input_tokens;
}

export function budgetClient({
  ledger,
  purpose,
  onCall = () => {},
  fetchImpl,
  preflight = false,
  holdbackMicro = 0,
}) {
  return {
    messages: {
      async create(params, options = {}) {
        const start = performance.now();
        let id,
          count,
          bound,
          phase = 'count';
        try {
          if (params.stream || params.service_tier === 'fast')
            throw new Error('Unregistered transport mode.');
          if (JSON.stringify(params).includes('"ttl":"1h"'))
            throw new Error('One-hour cache pricing is not registered.');
          count = await countRequest(params, { ...options, fetchImpl });
          bound = requestBound(params.model, count, params.max_tokens);
          if (preflight) {
            onCall({ params, count, bound, preflight: true });
            const error = new Error('Preflight captured request; no generation sent.');
            error.name = 'PreflightCaptured';
            throw error;
          }
          phase = 'reserve';
          id = randomUUID();
          ledger.reserve(id, params.model, bound, purpose, holdbackMicro);
          phase = 'send';
          const response = await post('messages', params, { ...options, fetchImpl });
          ledger.settle(id, response.usage);
          onCall({ id, params, response, count, bound, elapsedMs: performance.now() - start });
          return response;
        } catch (error) {
          if (error.name === 'PreflightCaptured') throw error;
          if (id && ledger.entries.get(id)?.status === 'reserved') ledger.uncertain(id);
          onCall({
            id,
            count,
            bound,
            phase,
            error: error.message,
            elapsedMs: performance.now() - start,
          });
          throw error;
        }
      },
    },
  };
}
