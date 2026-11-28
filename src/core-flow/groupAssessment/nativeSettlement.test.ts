import { describe, expect, it } from 'vitest';
import type { CommitEvent, EmitEvent, FlowSubflowEvent } from 'footprintjs';
import { MockProvider } from '../../adapters/llm/MockProvider.js';
import { Sequence } from '../Sequence.js';
import { Agent } from '../../core/Agent.js';
import { recordRun } from '../../recorders/observability/recordRun.js';

describe('native group assessment settlement', () => {
  it('joins the assessment commit under the final branch to the immediate member settlement', async () => {
    const reportedOutput = '{"answerAssessment":{"standing":"ask"}}';
    const agent = Agent.create({
      provider: new MockProvider({ reply: reportedOutput }),
      model: 'mock',
    })
      .system('')
      .answerLayer({ standingLine: false })
      .build();
    const sequence = Sequence.create().step('member', agent).build();
    const recording = recordRun(sequence);
    const events: (CommitEvent | EmitEvent | FlowSubflowEvent)[] = [];
    const detach = sequence.attach({
      id: 'group-assessment-settlement-fixture',
      onCommit(event) {
        if (event.mutations.some(({ key }) => key === 'answerAssessment')) events.push(event);
      },
      onEmit(event) {
        if (event.name === 'agentfootprint.agent.turn_end') events.push(event);
      },
      onSubflowExit(event) {
        if (event.subflowId === 'step-member' || event.subflowId === 'step-member/final') {
          events.push(event);
        }
      },
    });
    try {
      expect(await sequence.run({ message: 'Use the recorded evidence.' })).toBe(reportedOutput);
      expect(events).toHaveLength(4);
      const [assessmentCommit, terminal, finalExit, memberExit] = events as [
        CommitEvent,
        EmitEvent,
        FlowSubflowEvent,
        FlowSubflowEvent,
      ];
      const position = terminal.sourcePosition;
      expect(position).toBeDefined();
      if (!position) throw new Error('The terminal event must name its committed prefix');

      const [memberKey, finalKey] = position.drillPath;
      expect(position.drillPath).toHaveLength(2);
      if (!memberKey || !finalKey) throw new Error('The child and final native mounts must exist');
      expect(memberExit.traversalContext).toMatchObject({
        runtimeStageId: memberKey,
        runId: position.runId,
      });
      expect(finalExit.traversalContext).toMatchObject({
        runtimeStageId: finalKey,
        runId: position.runId,
      });
      expect(memberExit.outputState?.answerAssessment).toBeUndefined();
      expect(finalExit.outputState?.answerAssessment).toMatchObject({ standing: 'not-assessed' });

      const { snapshot } = recording.toRecording();
      const final = snapshot?.subflowResults?.[finalKey]?.treeContext;
      expect(final?.logAddress).toEqual({
        logRunId: position.logRunId,
        drillPath: position.drillPath,
      });
      const commit = final?.history?.[position.committedThroughIdx];
      expect(commit?.runtimeStageId).toBe(assessmentCommit.runtimeStageId);
      expect(commit?.runtimeStageId).not.toBe(terminal.runtimeStageId);
      expect(commit?.overwrite?.answerAssessment).toMatchObject({ standing: 'not-assessed' });
    } finally {
      detach();
      recording.stop();
    }
  });
});
