import {
  type CompletedAgentTurn,
  readCompletedTurn,
} from '../core/agent/turnEvidence/completedTurnHandle.js';
import { boundTurnEvidence } from '../core/agent/turnEvidence/completedTurnBudget.js';
import { coverageOfRecordedTurn } from '../core/agent/turnEvidence/coverage.js';
import { verdictOfRecordedTurn } from '../core/agent/turnEvidence/verdict.js';
import { assessmentDataFrom } from '../core/agent/assessment/compose.js';
import type { AssessmentReason } from '../core/agent/assessment/types.js';
import { recordedStandingWitnesses } from './facts/standing.js';
import { recordingView } from './view.js';

const omissionReasons: ReadonlySet<AssessmentReason> = new Set([
  'result-cut',
  'placed-unread',
  'result-dropped-from-window',
  'source-not-consulted',
]);

/** Project only admitted coverage and omission witnesses for the host-held turn. */
export async function readCompletedTurnCoverage(
  owner: object,
  handle: CompletedAgentTurn | undefined,
) {
  const admitted = await readCompletedTurn(owner, handle);
  if (admitted.status !== 'ready') return { gaps: [admitted.status] };
  const { turn } = admitted;
  const { snapshot, events, terminal } = turn;
  const runId = terminal.meta.runId;
  const facts = [];
  const gaps = new Set<string>();
  const coverage = coverageOfRecordedTurn(turn);
  if (coverage === undefined) gaps.add('coverage-not-collected');
  else facts.push({ kind: 'declared-coverage', calls: coverage });
  const verdict = verdictOfRecordedTurn(turn);
  if (verdict.status === 'not-checked') gaps.add('evidence-verdict-not-collected');
  else facts.push({ kind: 'evidence-verdict', status: verdict.status });

  const assessment = assessmentDataFrom(terminal.payload?.answerAssessment);
  if (assessment !== undefined) {
    const view = recordingView({ snapshot, events }, { runId });
    const reasons = assessment.reasons.filter((reason) => omissionReasons.has(reason));
    // Other withheld channels must not suppress a positively witnessed reason.
    const witnessed = recordedStandingWitnesses(view, []);
    for (const reason of reasons) {
      const record = witnessed?.reasons.find((entry) => entry.reason === reason);
      if (record === undefined || record.witness.length === 0) {
        gaps.add(reason);
      } else {
        facts.push({ kind: reason, pointers: record.witness });
      }
    }
  }
  // Positive witnesses do not establish a complete population of possible omissions.
  gaps.add('omission-coverage-incomplete');
  return boundTurnEvidence({ runId, facts, gaps: [...gaps] });
}
