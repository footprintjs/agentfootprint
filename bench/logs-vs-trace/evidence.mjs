import { createHash } from 'node:crypto';
import { TASK } from './capture.mjs';

export const bytesOf = (value) => Buffer.byteLength(value, 'utf8');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** A fixed scripted access plan verifies plumbing; its counts are not model turns. */
function tracePlan(decision) {
  return [
    { tool: 'run_overview', args: {} },
    { tool: 'who_wrote', args: { key: 'decision' } },
    { tool: 'trace_slice', args: { runtimeStageId: `${decision}#3` } },
    { tool: 'trace_node', args: { runtimeStageId: 'normalize#1' } },
    { tool: 'get_value', args: { runtimeStageId: 'intake#0', key: 'monthlyDebt' } },
    { tool: 'get_value', args: { runtimeStageId: 'intake#0', key: 'annualIncome' } },
    { tool: 'get_value', args: { runtimeStageId: 'intake#0', key: 'monthlyIncome' } },
    { tool: 'get_value', args: { runtimeStageId: 'normalize#1', key: 'dti' } },
  ];
}

export async function evidenceFor(arm, capture, doors) {
  if (!['logs', 'trace'].includes(arm)) throw new Error('Unknown evidence arm');
  if (
    arm === 'trace' &&
    (capture.captureStatus !== 'complete' || capture.artifacts === undefined)
  ) {
    return {
      arm,
      status: 'missing',
      task: structuredClone(TASK),
      limitations: [...capture.limitations],
      reason: 'The paired completed-run capture is missing; this pair is not graded.',
      responses: [],
      toolCalls: 0,
      utf8BytesServed: 0,
      evidenceDigest: null,
    };
  }
  const responses = [];
  if (arm === 'logs') {
    responses.push({ kind: 'application-log', content: capture.logs });
  } else {
    const tools = doors.traceToolpack(capture.artifacts);
    for (const call of tracePlan(capture.decision)) {
      responses.push({ ...call, content: await doors.callTraceTool(tools, call.tool, call.args) });
    }
  }
  return {
    arm,
    status: 'available',
    task: structuredClone(TASK),
    limitations: [...capture.limitations],
    responses,
    toolCalls: arm === 'trace' ? responses.length : 0,
    utf8BytesServed: responses.reduce((n, r) => n + bytesOf(r.content), 0),
    evidenceDigest: sha256(JSON.stringify(responses)),
  };
}
