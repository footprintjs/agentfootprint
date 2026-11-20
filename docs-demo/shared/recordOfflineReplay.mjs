import { deepStrictEqual, ok } from 'node:assert/strict';
import { weatherAnswer, weatherInput } from '../scripts/quick-start-weather.mjs';

export function assertOfflineReplayTrace(trace) {
  deepStrictEqual(trace.version, 1);
  deepStrictEqual(trace.redaction, 'pii');
  ok(trace.structure && typeof trace.structure === 'object', 'Replay needs the serialized chart');
  ok(!('snapshot' in trace), 'The public sample does not export a state snapshot');

  const events = trace.events;
  const root = events.filter((event) => event.isRoot);
  deepStrictEqual(root.map(({ type }) => type), ['run.entry', 'run.exit']);
  deepStrictEqual(root.map(({ payload }) => payload), ['[redacted]', '[redacted]']);
  const tools = events.filter(({ type }) => type === 'tool.start' || type === 'tool.end');
  deepStrictEqual(tools.map(({ type, toolCallId }) => [type, toolCallId]), [
    ['tool.start', 'call-weather-1'],
    ['tool.end', 'call-weather-1'],
  ]);
  deepStrictEqual(tools[0].toolName, 'weather');
  deepStrictEqual(tools[0].args, '[redacted]');
  deepStrictEqual(tools[1].result, '[redacted]');
  const replies = events.filter(({ type }) => type === 'llm.end');
  deepStrictEqual(replies.map(({ content, toolCallCount }) => [content, toolCallCount]), [
    ['[0 chars]', 1],
    [`[${weatherAnswer.length} chars]`, 0],
  ]);
  ok(events.some(({ type, target }) => type === 'loop.iteration' && target === 'LLM'));
}

// Current and published libraries each supply their own redactor and serializer.
export async function recordOfflineReplay(agent, { redactContent, stringifySnapshot }) {
  const dev = agent.enable.localObservability({ redact: redactContent });
  try {
    deepStrictEqual(await agent.run({ message: weatherInput }), weatherAnswer);
    const bytes = stringifySnapshot(dev.getTrace());
    const trace = JSON.parse(bytes);
    assertOfflineReplayTrace(trace);
    return { trace, bytes };
  } finally {
    dev.unsubscribe();
  }
}
