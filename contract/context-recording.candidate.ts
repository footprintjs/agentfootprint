/** $0 source contract, invoked with the concrete upstream value-table adapter. */
import assert from 'node:assert/strict';
import { Agent } from '../src/core/Agent.js';
import { MockProvider } from '../src/adapters/llm/MockProvider.js';
import { defineTool } from '../src/tools/tools.js';
import { defineSteering } from '../src/injection-engine/factories/defineSteering.js';
import { recordExample } from '../examples/observability/27-context-values.js';
import { toWireJson } from '../src/lib/wireJson.js';
import { recordRun } from '../src/recorders/observability/recordRun.js';
import {
  recordContextRun,
  readContextRecording,
} from '../src/recorders/observability/contextRecording.js';
import { writeContextRecording } from '../src/recorders/observability/contextRecording/write.js';
import type {
  ContextValueWriter,
  OpenContextValues,
} from '../src/recorders/observability/contextRecording.js';

interface ValueAdapter {
  createValueTable(options: { redact: (value: unknown) => unknown }): ContextValueWriter;
  readValueRecord: OpenContextValues;
}

function exampleAgent(requests: string[]) {
  let calls = 0;
  let builder = Agent.create({
    model: 'mock',
    provider: new MockProvider({
      respond(request) {
        requests.push(JSON.stringify(request));
        return ++calls < 9
          ? { toolCalls: [{ id: `advance-${calls}`, name: 'advance_step', args: {} }] }
          : 'All declared steps completed.';
      },
    }),
  }).system('Preserve the complete declared context. '.repeat(80));
  for (let i = 0; i < 11; i++)
    builder = builder.steering(
      defineSteering({
        id: `rule-${i}`,
        prompt: `Rule ${i}: ${'Use the recorded evidence and state what it does not establish. '.repeat(
          40,
        )}`,
      }),
    );
  for (let i = 0; i < 18; i++)
    builder = builder.tool(
      defineTool({
        name: i === 0 ? 'advance_step' : `available_tool_${i}`,
        description: `Tool ${i}. ${'Reads one explicitly selected item and reports its coverage. '.repeat(
          12,
        )}`,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: () => ({ ref: 'literal-reference-shaped-data', value: 'complete' }),
      }),
    );
  return builder.maxIterations(10).build();
}

export async function contextRecordingCandidate(adapter: ValueAdapter) {
  const plainRequests: string[] = [];
  const ordinary = exampleAgent(plainRequests);
  const ordinaryRecorder = recordRun(ordinary);
  await ordinary.run({ message: 'Perform the declared steps.' });
  ordinaryRecorder.stop();

  const recordedRequests: string[] = [];
  const runner = exampleAgent(recordedRequests);
  const off = runner.on('agentfootprint.context.recorded', () => undefined);
  const recorder = recordRun(runner);
  await runner.run({ message: 'Perform the declared steps.' });
  recorder.stop();
  off();
  const raw = recorder.toRecording();
  const values = adapter.createValueTable({ redact: (value) => value });
  const saved = await writeContextRecording(
    raw,
    values,
    recorder.droppedEvents,
    recorder.firstRetainedEventIndex,
  );
  const opened = await readContextRecording(
    JSON.parse(JSON.stringify(saved)),
    adapter.readValueRecord,
  );
  const expected = {
    ...raw,
    events: raw.events.filter((event) => event.type !== 'agentfootprint.context.recorded'),
  };
  assert.deepEqual(JSON.parse(toWireJson(opened.recording)), JSON.parse(toWireJson(expected)));
  assert.deepEqual(recordedRequests, plainRequests);
  assert.equal(opened.calls.length, 9);
  assert.equal(opened.calls[0].counts.tools, 18);
  assert.equal(
    opened.calls
      .slice(1)
      .every(
        (call) => call.added.length === 0 && call.removed.length === 0 && call.unchanged === 30,
      ),
    true,
  );

  // The public producer uses the same concrete adapter, not a second interner.
  const publicRequests: string[] = [];
  const publicRunner = exampleAgent(publicRequests);
  const publicRecorder = recordContextRun(
    publicRunner,
    adapter.createValueTable({ redact: (value) => value }),
  );
  await publicRunner.run({ message: 'Perform the declared steps.' });
  publicRecorder.stop();
  const publicSaved = await publicRecorder.toRecording();
  const publicRead = await readContextRecording(
    JSON.parse(JSON.stringify(publicSaved)),
    adapter.readValueRecord,
  );
  assert.equal(publicRead.calls.length, 9);
  assert.deepEqual(publicRequests, plainRequests);

  const capturedPlainBytes = Buffer.byteLength(toWireJson(expected));
  const documented = await recordExample(
    adapter.createValueTable({ redact: (value) => value }),
    adapter.readValueRecord,
  );
  assert.equal(documented.lines.length, 1);
  const plainBytes = Buffer.byteLength(toWireJson(ordinaryRecorder.toRecording()));
  const tableBytes = Buffer.byteLength(JSON.stringify(saved));
  assert.ok(tableBytes < plainBytes, 'the actual saved record must be smaller');
  return {
    calls: opened.calls.length,
    plainBytes,
    capturedPlainBytes,
    tableBytes,
    exactExpansion: true,
    providerRequestsUnchanged: true,
  };
}
