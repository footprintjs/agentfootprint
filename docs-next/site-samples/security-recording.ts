import { mock } from 'agentfootprint/providers';

export const ANSWER = 'He said "no".\nThe refund for A-1042 is denied.';
const provider = mock({ reply: ANSWER });

// #region code
import { Agent } from 'agentfootprint';
import { openRecording, recordRun } from 'agentfootprint/observe';
import { conversationRedaction } from 'agentfootprint/security';

// Walk the values, because the JSON form escapes quotes and newlines. Also catches text already encoded inside a string.
const keepOut = (value: unknown, text: string): unknown => {
  if (typeof value === 'string') return value.replaceAll(text, '[kept out]').replaceAll(JSON.stringify(text).slice(1, -1), '[kept out]');
  if (Array.isArray(value)) return value.map((item) => keepOut(item, text));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, keepOut(item, text)]));
  return value;
};

const agent = Agent.create({ provider, model: 'mock', redact: conversationRedaction() }).build();
const recorder = recordRun(agent);
const answer = String(await agent.run({ message: 'Summarize the case.' }));

const recording = answer ? keepOut(recorder.toRecording(), answer) : recorder.toRecording();

// Fail closed: never store a recording that still holds the answer.
if (answer && JSON.stringify(recording).includes(JSON.stringify(answer).slice(1, -1))) {
  throw new Error('The answer is still in the recording.');
}

const artifacts = openRecording(recording as ReturnType<typeof recorder.toRecording>);
// #endregion code

export { artifacts, keepOut, recording };
export const before = JSON.stringify(recorder.toRecording());
