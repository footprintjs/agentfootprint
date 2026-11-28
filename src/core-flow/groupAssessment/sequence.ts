import type { CombinedRecorder, EmitEvent, RunView } from 'footprintjs';
import { commitValueAt, isCommitBundle } from 'foottrace';
import { projectEventSourcePosition } from '../../bridge/eventSourcePosition.js';
import type { AnswerAssessmentPayload } from '../../events/payloads/answer.js';
import type { EventSourcePosition } from '../../events/types.js';
import { STAGE_IDS, SUBFLOW_IDS } from '../../lib/conventions.js';
import { reduceGroupStanding, type MemberStanding } from './standing.js';

type Standing = AnswerAssessmentPayload['standing'];

interface TerminalAssessment {
  readonly position: EventSourcePosition;
  readonly standing: Standing;
}

interface MemberSettlement {
  readonly mount: string;
  readonly terminal?: TerminalAssessment;
}

interface SequenceEvidence {
  readonly runId: () => string;
  readonly authored: (event: EmitEvent) => boolean;
  readonly snapshot: () => ReturnType<RunView['snapshot']>;
}

function ownValue(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function standingOf(assessment: unknown): Standing | undefined {
  const standing = ownValue(assessment, 'standing');
  switch (standing) {
    case 'known':
    case 'consistent':
    case 'not-assessed':
    case 'not-sure':
    case 'ask':
      return standing;
    default:
      return undefined;
  }
}

/** A single opted-in top-level Sequence leg. Scope both physical boundaries before retaining a terminal. */
export function sequenceAssessment(
  steps: readonly string[],
  hasScopeGap: boolean,
  evidence: SequenceEvidence,
) {
  const mounts = new Set(steps.map((step) => `step-${step}`));
  const terminalByMember = new Map<string, TerminalAssessment>();
  const finalByMember = new Map<string, TerminalAssessment>();
  const settlements = new Map<string, MemberSettlement>();
  let conflictingSettlement = false;

  const recorder: CombinedRecorder = {
    id: 'af-sequence-group-assessment',
    onEmit(event) {
      if (event.name !== 'agentfootprint.agent.turn_end' || !evidence.authored(event)) return;
      const [memberId, final] = event.subflowPath;
      if (
        event.subflowPath.length !== 2 ||
        memberId === undefined ||
        !mounts.has(memberId) ||
        final !== SUBFLOW_IDS.FINAL
      )
        return;
      const position = projectEventSourcePosition(event);
      const standing = standingOf(ownValue(event.payload, 'answerAssessment'));
      if (
        position?.engineRunId !== evidence.runId() ||
        position.drillPath.length !== 2 ||
        position.committedThroughIdx < 0 ||
        standing === undefined ||
        standing === 'not-assessed'
      )
        return;

      terminalByMember.set(memberId, { position, standing });
    },
    onSubflowExit(event) {
      const id = event.subflowId;
      const context = event.traversalContext;
      if (id === undefined || context?.runId !== evidence.runId()) return;

      if (mounts.has(id)) {
        const mount = context.runtimeStageId;
        const prior = settlements.get(id);
        if (prior) {
          if (prior.mount !== mount) conflictingSettlement = true;
          return;
        }
        const terminal = finalByMember.get(id);
        settlements.set(id, {
          mount,
          ...(terminal?.position.drillPath[0] === mount && { terminal }),
        });
        terminalByMember.delete(id);
        finalByMember.delete(id);
        return;
      }

      const finalSuffix = `/${SUBFLOW_IDS.FINAL}`;
      if (!id.endsWith(finalSuffix)) return;
      const member = id.slice(0, -finalSuffix.length);
      const terminal = terminalByMember.get(member);
      if (
        terminal?.position.drillPath[1] === context.runtimeStageId &&
        standingOf(ownValue(event.outputState, 'answerAssessment')) === terminal.standing
      )
        finalByMember.set(member, terminal);
    },
  };

  return {
    recorder,
    summarize() {
      // Verify addresses together in the live native Finalize stage. The default
      // path and runs without a retained terminal take no extra snapshot.
      let snapshot: ReturnType<RunView['snapshot']>;
      if ([...settlements.values()].some(({ terminal }) => terminal !== undefined)) {
        try {
          snapshot = evidence.snapshot();
        } catch {
          // A failed evidence read does not change delivery.
        }
      }
      const members = [...settlements.entries()].map(([id, { terminal }]): MemberStanding => {
        const standing = committedStanding(id, terminal, snapshot);
        return standing === undefined
          ? { coverage: 'incomplete' }
          : { standing, coverage: 'complete' };
      });
      return reduceGroupStanding(
        members,
        hasScopeGap || conflictingSettlement || settlements.size < mounts.size,
      );
    },
  };
}

function committedStanding(
  member: string,
  terminal: TerminalAssessment | undefined,
  snapshot: ReturnType<RunView['snapshot']>,
): Standing | undefined {
  if (!terminal || !snapshot) return undefined;
  const { drillPath, logRunId, committedThroughIdx } = terminal.position;
  const finalMount = drillPath[1];
  if (finalMount === undefined) return undefined;
  const tree = ownValue(ownValue(snapshot.subflowResults, finalMount), 'treeContext');
  const address = ownValue(tree, 'logAddress');
  const actualPath = ownValue(address, 'drillPath');
  if (
    ownValue(address, 'logRunId') !== logRunId ||
    !Array.isArray(actualPath) ||
    actualPath.length !== drillPath.length ||
    !drillPath.every((part, index) => ownValue(actualPath, String(index)) === part)
  )
    return undefined;

  const commit = ownValue(ownValue(tree, 'history'), String(committedThroughIdx));
  if (
    !isCommitBundle(commit) ||
    commit.stageId !== `${member}/${SUBFLOW_IDS.FINAL}/${STAGE_IDS.ASSESS_ANSWER}`
  )
    return undefined;
  const standing = standingOf(commitValueAt([commit], 0, 'answerAssessment'));
  return standing === terminal.standing ? standing : undefined;
}
