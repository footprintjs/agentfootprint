/** Every projection states the same leg-only evidence boundary. */
import type { LLMMessage } from '../../provider-contract/types.js';
import { SNAPSHOT_PROJECTIONS, type SnapshotProjection } from '../define.types.js';
import type { SnapshotEntry } from './types.js';

const LIMITATION =
  'The past answer may use earlier admitted history; evidence shows only this component execution leg. ' +
  'Evidence from prior legs and missing observations is unknown. Empty lists do not prove no operations.';

export function formatSnapshot(
  snap: SnapshotEntry,
  projection: SnapshotProjection,
  score: number,
): LLMMessage {
  const query = snap.query.length > 80 ? snap.query.slice(0, 79) + '…' : snap.query;
  const header = '[Past run · query: "' + query + '" · score: ' + score.toFixed(2) + ']';
  const status =
    snap.availability === 'partial'
      ? 'Partial evidence: ' + snap.causes.join(', ') + '.'
      : snap.availability === 'unavailable'
      ? 'Evidence unavailable: ' + snap.reason + '.'
      : 'Observed evidence in this leg only.';
  let body: string;
  switch (projection) {
    case SNAPSHOT_PROJECTIONS.DECISIONS: {
      const decisions = snap.availability === 'unavailable' ? [] : snap.decisions;
      const tools = snap.availability === 'unavailable' ? [] : snap.toolCalls;
      const decisionText = decisions
        .map(
          (d) =>
            '- ' +
            d.stageId +
            ' → "' +
            d.chosen +
            '"' +
            (d.rule ? ' (rule: ' + d.rule + ')' : '') +
            (d.evidence ? '; evidence: ' + JSON.stringify(d.evidence) : ''),
        )
        .join('\n');
      const toolText = tools.length
        ? '\nTool evidence:\n' +
          tools
            .map(
              (t) =>
                '- ' +
                t.name +
                '(' +
                JSON.stringify(t.args) +
                ') → ' +
                t.resultPreview +
                (t.errored ? ' [ERROR]' : ''),
            )
            .join('\n')
        : '';
      body =
        (decisionText || toolText ? decisionText + toolText : '(no decision evidence captured)') +
        '\nFinal answer: ' +
        snap.finalContent;
      break;
    }
    case SNAPSHOT_PROJECTIONS.NARRATIVE:
      body = snap.narrative ?? '(no narrative captured)\nFinal answer: ' + snap.finalContent;
      break;
    case SNAPSHOT_PROJECTIONS.COMMITS:
      body = '(no commit log captured)\nFinal answer: ' + snap.finalContent;
      break;
    case SNAPSHOT_PROJECTIONS.FULL:
      body = JSON.stringify(snap, null, 2);
      break;
    default:
      body = 'Final answer: ' + snap.finalContent;
  }
  return {
    role: 'system',
    content: header + '\n' + LIMITATION + '\n' + status + '\n' + body,
  } as LLMMessage;
}
