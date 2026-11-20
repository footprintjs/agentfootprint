import { expect } from 'vitest';
import type { Agent, AgentInput } from '../../../../src/index.js';
import { toSSE } from '../../../../src/hosting/stream.js';
import type { AgentTurnEndPayload } from '../../../../src/events/payloads/agent.js';
import type { AnswerAssessedPayload } from '../../../../src/events/payloads/answer.js';
import { assessAnswer, recordRun, type Recording } from '../../../../src/observe.js';
import { runAsAgUi } from '../../../ag-ui/helpers.js';

type ResultRecording = Recording & {
  snapshot: {
    sharedState: {
      history: Record<string, unknown>[];
      middlewareDecisions?: unknown;
      withheldToolResultTurn?: number;
      coverageDeclared?: unknown;
      findingsLedger?: unknown;
    };
  };
};

/** Observe the same turn through the answer doors, including AG-UI assistant text. */
export async function observeStanding(agent: Agent, input: AgentInput) {
  const turnEnds: AgentTurnEndPayload[] = [];
  const assessed: AnswerAssessedPayload[] = [];
  const offTurn = agent.on('agentfootprint.agent.turn_end', ({ payload }) =>
    turnEnds.push(payload),
  );
  const offAssessed = agent.on('agentfootprint.answer.assessed', ({ payload }) =>
    assessed.push(payload),
  );
  const recorder = recordRun(agent);
  // A heartbeat lets return() close a pending read if the fixture loses its terminal event.
  const stream = toSSE(agent, { format: 'text', heartbeatMs: 50 });
  const first = stream.next();
  try {
    const agui = await runAsAgUi(agent, input);
    if (agui.error !== undefined) throw agui.error;
    expect(
      agui.served.some(
        (event) => event.type === 'agentfootprint.agent.turn_end' && event.meta?.rootTurn,
      ),
      'public root turn_end closes text SSE',
    ).toBe(true);
    const chunks: string[] = [];
    const initial = await first;
    if (!initial.done) chunks.push(initial.value);
    for await (const chunk of stream) chunks.push(chunk);
    const sse = chunks.filter((chunk) => chunk !== ': ping\n\n').join('');
    const aguiText = agui.events
      .flatMap((event) => (event.type === 'TEXT_MESSAGE_CONTENT' ? [event.delta] : []))
      .join('');
    const recordingText = JSON.stringify(recorder.toRecording());
    const recording = JSON.parse(recordingText) as ResultRecording;
    const saved = assessAnswer(recording);
    expect(turnEnds).toHaveLength(1);
    expect(assessed).toHaveLength(1);
    const { turn, iteration, ...eventAssessment } = assessed[0]!;
    expect(turn).toBe(1);
    return {
      returned: agui.out,
      sse,
      aguiText,
      turnEnd: turnEnds[0]!,
      eventAssessment,
      iteration,
      saved,
      recording,
      recordingText,
    };
  } finally {
    await stream.return(undefined);
    recorder.stop();
    offTurn();
    offAssessed();
  }
}
