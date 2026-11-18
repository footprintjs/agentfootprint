# Pre-stamp tool approval decline

`legacy-tool-approval-declined.json.gz` contains the runtime recording captured for Lane D’s second read of #350, on AgentFootprint `14.10.1` from [main commit `2cb635f03009916ade1dba57342b7f630f7d4139`](https://github.com/footprintjs/agentfootprint/commit/2cb635f03009916ade1dba57342b7f630f7d4139). AgentFootprint’s scripted `mock` provider proposed a `lookup` call. The `gate` middleware requested approval and a synthetic reviewer declined via `checkInDeclined`. The capture checked that `lookup`’s body was entered zero times. All inputs were synthetic and the provider made no model requests.

The original `JSON.stringify(recorder.toRecording())` bytes were compressed with `gzip -n -9`. The gzip expands to the exact bytes of the second-read capture. Its events, snapshot and structure are preserved in full.

| Item | Value |
| --- | --- |
| Gzip SHA-256 | `5acc3b9fb87f57317a754994420cccc42853208e03e0391aee287d1aaf6803bd` |
| JSON SHA-256 | `c59d02903f24ea11ebb3d790edca4e61d9c45852ec7f4cfb9d9ec22229f773a7` |
| JSON size | 155,331 bytes |
| Stream events | 38 |
| Snapshot commit-log entries | 21 |
| Tool call ID | `legacy-call` |
| Snapshot log address | `logRunId: 1795008268626-0000000002`, `drillPath: []` |

The `agentfootprint.pause.request` and `agentfootprint.pause.resume` events share a request ID, with `approved: false` on the resume. The `gate` middleware decision for `legacy-call` records `deny`. The `agentfootprint.stream.tool_end` for that call records `result: "declined by human"` and has neither `error` nor `entered`.

## Regenerate the capture

Use a separate checkout at the source commit and install its locked dependencies. Set `LEGACY_DECLINE_RECORDING` to the absolute path of a fresh JSON output file. Save the probe below as `test/answer-account/capture-legacy-decline.test.ts` in that checkout. The recorder chooses run IDs and timestamps, so a new capture will have different hashes.

```sh
git switch --detach 2cb635f03009916ade1dba57342b7f630f7d4139
npm ci
LEGACY_DECLINE_RECORDING="$PWD/legacy-tool-approval-declined.json" \
  npx --no-install vitest run test/answer-account/capture-legacy-decline.test.ts
gzip -n -9 -c legacy-tool-approval-declined.json > legacy-tool-approval-declined.json.gz
```

```ts
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Agent, ask, checkInDeclined, defineTool, isAskPause } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { recordRun } from '../../src/observe.js';
import { pausedRequest } from '../helpers/pausedRequest.js';

it('captures a declined approval before tool entry was stamped', async () => {
  const output = process.env.LEGACY_DECLINE_RECORDING;
  if (!output) throw new Error('Set LEGACY_DECLINE_RECORDING to the JSON output path');

  let entered = 0;
  const lookup = defineTool({
    name: 'lookup',
    description: 'Read a synthetic sample',
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      entered++;
      return 'sample';
    },
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'legacy-call', name: 'lookup', args: {} }] },
        { content: 'Done.' },
      ],
    }),
    model: 'mock',
  })
    .tool(lookup)
    .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'Read the sample?' }) })
    .build();

  const recorder = recordRun(agent);
  const paused = await agent.run({ message: 'Read the sample' });
  if (!isAskPause(paused)) throw new Error('Expected a middleware approval pause');
  await agent.resume(paused.checkpoint, checkInDeclined({ request: pausedRequest(paused), by: 'reviewer' }));
  recorder.stop();

  const recording = recorder.toRecording();
  const end = recording.events.findLast((event) => event.type === 'agentfootprint.stream.tool_end');
  expect(entered).toBe(0);
  expect(end?.payload).toMatchObject({ toolCallId: 'legacy-call', result: 'declined by human' });
  expect(end?.payload).not.toHaveProperty('error');
  expect(end?.payload).not.toHaveProperty('entered');
  writeFileSync(output, JSON.stringify(recording));
});
```
