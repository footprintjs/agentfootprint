import { Buffer } from 'node:buffer';

import { createPilotDesk, visibleResults } from './desk.mjs';
import { limits } from './plan.mjs';
import { scoreAnswer } from './scorer.mjs';
import { systemPrompt } from './tasks.mjs';

const nonterminalStops = new Set(['max_tokens', 'refusal', 'model_context_window_exceeded', 'tool_use']);
const snapshot = (value) => JSON.parse(JSON.stringify(value));

export async function runOne(library, tokens, model, { task, arm, repeat }, {
  budget, append, prepareRequest = (request) => request,
} = {}) {
  const { family, side } = task;
  const run = { family, side, arm, repeat };
  const requests = [];
  const desk = createPilotDesk(library, task, arm);
  let capReached = false;
  let dispatchError;
  const provider = {
    name: model.name,
    async complete(request) {
      if (dispatchError) throw dispatchError;
      if (requests.length >= limits.maxRequests) {
        capReached = true;
        throw new Error('Pilot request limit reached');
      }
      const dispatched = prepareRequest({ ...request, maxTokens: limits.maxTokens });
      const requestProof = snapshot(dispatched);
      const slots = visibleResults(requestProof.messages, desk.bindings);
      const inputBytes = Buffer.byteLength(JSON.stringify({
        system: dispatched.systemPrompt, messages: dispatched.messages,
        tools: dispatched.tools?.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      }));
      const requestIndex = requests.length;
      const ticket = budget?.reserve({ ...run, request: requestIndex + 1, inputBytes, maxTokens: limits.maxTokens });
      const entry = { inputBytes, request: requestProof, ...slots };
      requests.push(entry);
      append?.({ type: 'request', ...run, requestIndex, attempt: ticket?.id, ...entry });
      let response;
      try {
        response = await model.complete(dispatched);
      } catch (error) {
        dispatchError = error;
        if (ticket) entry.accounting = budget.settle(ticket, undefined);
        append?.({ type: 'provider-error', ...run, requestIndex, attempt: ticket?.id, error: error?.name });
        throw error;
      }
      entry.response = response === undefined ? undefined : snapshot(response);
      append?.({ type: 'response', ...run, requestIndex, attempt: ticket?.id, response: entry.response });
      if (ticket) entry.accounting = budget.settle(ticket, response?.usage);
      return response;
    },
  };
  const agent = desk.apply(library.Agent.create({
    provider, model: limits.model, maxIterations: limits.maxRequests, maxTokens: limits.maxTokens,
  }).system(systemPrompt(arm))).build();
  let ended = false;
  try {
    ended = typeof await agent.run({ message: task.message }) === 'string';
  } catch (error) {
    if (!dispatchError && !capReached && !budget?.snapshot().stopped) throw error;
  }
  const final = requests.at(-1);
  const response = final?.response;
  const terminal = ended && typeof response?.content === 'string' && !response.toolCalls?.length &&
    !nonterminalStops.has(response.stopReason);
  const answerRequestIndex = terminal ? requests.length - 1 : null;
  const answer = terminal ? response.content : '';
  const visible = terminal ? final.visible : [];
  const ending = budget?.snapshot().stopped ? 'spend-stop' : dispatchError ? 'provider-error'
    : terminal ? 'answered' : capReached ? 'request-cap' : (response?.stopReason ?? 'unanswered');
  return {
    ...run, task, requests, answerRequestIndex, answer, ending, bindings: desk.bindings,
    score: scoreAnswer({ task, answer, bindings: desk.bindings, visible }, tokens),
  };
}
