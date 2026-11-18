import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { callTraceTool, openRecording, traceToolpack } from 'agentfootprint/observe';
import { expect, it } from 'vitest';

it('replays the saved Agentfootprint 14.3.1 tool call and finds its committed value', async () => {
  const fixture = new URL('./fixtures/recording-14.3.1.json.gz', import.meta.url);
  const json = gunzipSync(readFileSync(fixture), { maxOutputLength: 256 * 1024 }).toString('utf8');
  const tools = traceToolpack(openRecording(JSON.parse(json)));

  const overview = await callTraceTool(tools, 'run_overview');
  expect(overview).toContain('tool-calls ×1');

  const call = await callTraceTool(tools, 'inspect_tool_call', { toolCallId: 'fixture-call-1' });
  expect(call).toContain('TOOL CALL fixture-call-1 — lookup_widget');
  expect(call).toContain('proposed by the model: {"code":"WIDGET-FIXTURE"}');
  expect(call).toContain('Widget WIDGET-FIXTURE inventory 17');

  const result = await callTraceTool(tools, 'find_in_trace', {
    query: 'Widget WIDGET-FIXTURE inventory 17',
  });
  expect(result).toContain('FOUND');
  expect(result).toMatch(/→ get_value\('.*#\d+', '.*'\)/);
});
