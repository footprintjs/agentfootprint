import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { conversationRedaction } from 'agentfootprint/security';

const agent = Agent.create({ provider: mock({ reply: 'the-answer-7731' }), model: 'mock', redact: conversationRedaction() }).build();

// #region code
import { openRecording, recordRun } from 'agentfootprint/observe';

const recorder = recordRun(agent);
const answer = await agent.run({ message: 'Summarize the case.' });

// Replace the answer's text before you store the recording.
const recording = JSON.parse(JSON.stringify(recorder.toRecording()).replaceAll(String(answer), '[kept out]'));

// It still opens as a normal recording.
const artifacts = openRecording(recording);
// #endregion code

export { artifacts, recording };
