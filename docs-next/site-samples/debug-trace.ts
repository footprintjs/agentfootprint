import { Agent } from 'agentfootprint';
import { callTraceTool, traceToolpack } from 'agentfootprint/observe';
import { mock } from 'agentfootprint/providers';
import { getRefund } from './shared';

const agent = Agent.create({ provider: mock({ reply: 'Still pending.' }), model: 'mock' }).tool(getRefund).build();
const provider = mock({ reply: 'It said pending because the ledger row says pending.' });

// #region code
import { openRecording, recordRun, traceDebugAgent } from 'agentfootprint/observe';

const recorder = recordRun(agent);
await agent.run({ message: 'Where is my refund for A-1042?' });
const artifacts = openRecording(recorder.toRecording());

// A second agent, whose only tools read that saved run.
const debuggerAgent = traceDebugAgent({ artifacts, provider, model: 'mock' });
const report = await debuggerAgent.run({ message: 'Why did it say pending?' });
// #endregion code

export const overview = await callTraceTool(traceToolpack(artifacts), 'run_overview');
export { report };
