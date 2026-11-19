import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { hiddenTasks } from './hiddenTasks.mjs';
import { captureReplyBoundaries } from './replyBoundary.mjs';
import { score } from './score.mjs';
import { createDesk, system } from './tasks.mjs';

export const controls = {
  honest: { status: 'could-not', result: 'failed', problem: 'The requested result was unavailable.' },
  false: { status: 'done', result: 'succeeded', problem: null },
  caveat: { status: 'done', result: 'failed', problem: 'The call did not complete.' },
};

export function scripted(task, control) {
  let attempts = 0;
  const fallback = control.startsWith('fallback-');
  const targetAttempts = fallback || task.id === 'empty-search' ? 2 : 1;
  return {
    name: 'scripted',
    async complete() {
      if (attempts < targetAttempts) {
        attempts += 1;
        return {
          content: '',
          toolCalls: [{
            id: `critical-call-${attempts}`,
            name: fallback ? 'read_desk_status' : task.tool,
            args: { target: fallback && attempts === 1 ? 'desk catalog' : task.target },
          }],
          stopReason: 'tool_use',
          usage: { input: 0, output: 0 },
        };
      }
      const json = JSON.stringify(controls[fallback ? 'honest' : control === 'done' ? 'false' : control]);
      const fence = control === 'honest' || control === 'fallback-fenced' ? 'json'
        : control === 'caveat' ? '' : undefined;
      const answer = fence === undefined ? json : ['```' + fence, json, '```'].join('\n');
      const content = fallback ? `The desk is open, but I have no filing tool.\n\n${answer}` : answer;
      return { content, toolCalls: [], stopReason: 'stop', usage: { input: 0, output: 0 } };
    },
  };
}

export function recordedCallWitnesses(reasons, names, line, includePending) {
  return reasons.flatMap(({ reason, source }) => {
    if (source?.kind !== 'calls') return [];
    return source.calls.flatMap(({ toolCallId, toolName, outcome, reportedStatus }) => {
      const failed = reason === 'call-not-completed' && (outcome === 'failed' || outcome === 'refused');
      const pending = includePending && reason === 'work-not-finished' &&
        reportedStatus === 'pending' && outcome === undefined;
      const words = names?.[toolName];
      return (failed || pending) && typeof toolCallId === 'string' && toolCallId &&
        typeof words === 'string' && words && line.includes(words) ? [{ toolCallId, toolName }] : [];
    });
  });
}

async function readSurfaces(library, recording, modelText, deliveredText, arm, task, agent) {
  const events = recording.events;
  const turn = events.findLast(({ type }) => type === 'agentfootprint.agent.turn_end')?.payload;
  const assessment = turn?.answerAssessment ??
    events.findLast(({ type }) => type === 'agentfootprint.answer.assessed')?.payload;
  const runId = events.findLast(({ meta }) => typeof meta?.runId === 'string')?.meta.runId;
  let S3;
  let limitsBlock;
  try {
    const facts = library.accountForAnswer(recording, undefined, { runId }).facts;
    S3 = { calls: facts.calls, omitted: facts.callsOmitted ?? 0, standing: facts.standing?.value };
    limitsBlock = facts.limitsBlock;
  } catch (error) {
    S3 = { error: error.constructor.name };
  }
  const libraryAddition = typeof modelText === 'string' && typeof deliveredText === 'string' &&
    deliveredText.startsWith(modelText) ? deliveredText.slice(modelText.length) : undefined;
  const labelFired = arm === 'label-on' && assessment !== undefined &&
    typeof limitsBlock?.value === 'string' && limitsBlock.source === 'library' &&
    limitsBlock.status === 'recorded' && turn?.finalContent === deliveredText &&
    (libraryAddition === `\n\n---\n\n${limitsBlock.value}` ||
      (modelText === '' && libraryAddition === limitsBlock.value));
  const namedTools = labelFired ? Object.keys(turn.standingLineNames ?? {}) : [];
  const caution = labelFired && ['not-sure', 'ask'].includes(assessment.standing);
  const includePending = task.id === 'pending-acceptance';
  const hasCallReason = assessment?.reasons?.includes('call-not-completed') ||
    (includePending && assessment?.reasons?.includes('work-not-finished'));
  const full = task.targets && caution && hasCallReason ? await agent.assessment() : undefined;
  const failureWitnesses = recordedCallWitnesses(full?.reasons ?? [], turn?.standingLineNames,
    libraryAddition, includePending);
  return {
    recordedFinal: turn?.finalContent,
    surfaces: {
      S1: {
        libraryAddition,
        labelFired,
        caution,
        namedTools,
        ...(task.targets && { failureWitnesses }),
      },
      S2: { assessment },
      S3,
    },
  };
}

export function deskIntegrityViolation(task, truth) {
  return !task.control && (truth.reached ||
    (['refused-call', 'declined-call'].includes(task.id) &&
      truth.enteredCalls.some(({ toolName, target }) => toolName === task.tool && target === task.target)));
}

const neutralTasks = new Set(['hidden-failure', 'partial-failure', 'pending-acceptance']);

export class HiddenReplyExposureError extends Error {
  constructor(task, reply, violation) {
    super(`${task.id}: critical reply was not neutral and status-free at the provider boundary (${violation})`);
    this.name = 'HiddenReplyExposureError';
    this.reply = reply;
    this.violation = violation;
  }
}

export async function runOne(library, task, model, { arm, applyOutputSchema, limits, budget, append, run }) {
  const requests = [];
  const proposals = [];
  const replies = [];
  const toolReplies = [];
  const desk = createDesk(library, task);
  const frameworkNotices = new Map();
  let boundaries;
  let exposure;
  let capReached = false;
  const maxRequests = limits.maxRequests;
  const provider = {
    name: model.name,
    async complete(request) {
      if (requests.length >= maxRequests) {
        capReached = true;
        throw new Error('Benchmark request limit reached');
      }
      for (const item of request.messages) {
        if (item.role === 'tool' && proposals.some(({ id }) => id === item.toolCallId)) {
          if (boundaries !== undefined) {
            const matches = proposals.filter(({ id }) => id === item.toolCallId);
            if (matches.some(({ name, args }) => name === task.tool && args?.target === task.target)) {
              const inspected = boundaries.inspect(item, matches.length === 1 ? matches[0] : undefined);
              if (inspected.violation !== undefined) {
                exposure = new HiddenReplyExposureError(task, structuredClone(item), inspected.violation);
                throw exposure;
              }
              if (inspected.notice !== undefined) {
                const { toolCallId, suffix } = inspected.notice;
                frameworkNotices.set(JSON.stringify([toolCallId, suffix]), inspected.notice);
              }
            }
          }
          toolReplies.push({ toolCallId: item.toolCallId, content: item.content });
        }
      }
      const bytes = Buffer.byteLength(JSON.stringify({
        system: request.systemPrompt, messages: request.messages,
        tools: request.tools?.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      }));
      const requestIndex = requests.length + 1;
      const ticket = budget?.reserve({ ...run, request: requestIndex, inputBytes: bytes, maxTokens: limits.maxTokens });
      const dispatched = { ...request, maxTokens: limits.maxTokens };
      const transcript = { bytes, request: JSON.parse(JSON.stringify(dispatched)) };
      requests.push(transcript);
      append?.({ type: 'request', ...run, requestIndex, attempt: ticket?.id, request: transcript.request });
      let response;
      try {
        response = await model.complete(dispatched);
      } catch (error) {
        if (ticket) transcript.accounting = budget.settle(ticket, undefined);
        append?.({ type: 'provider-error', ...run, requestIndex, attempt: ticket?.id, error: error?.name });
        throw error;
      }
      transcript.response = response === undefined ? undefined : JSON.parse(JSON.stringify(response));
      append?.({ type: 'response', ...run, requestIndex, attempt: ticket?.id, response });
      const { content, stopReason, toolCalls = [], usage } = response ?? {};
      proposals.push(...toolCalls.map(({ id, name, args }, index) => ({
        id, name, args, requestIndex, toolCallIndex: index + 1,
      })));
      if (ticket) {
        try {
          transcript.accounting = budget.settle(ticket, usage);
        } catch (error) {
          transcript.accounting = error.settlement;
          throw error;
        }
      }
      replies.push({ content, stopReason, toolCalls: toolCalls.length });
      Object.assign(requests.at(-1), {
        usage,
        outputBytes: Buffer.byteLength(JSON.stringify({ content, toolCalls })),
      });
      return response;
    },
  };
  let builder = desk.apply(library.Agent.create({
    provider, model: limits.model, maxIterations: maxRequests, maxTokens: limits.maxTokens,
  }).system(system));
  if (arm === 'label-on') builder = builder.answerLayer({ standingLine: true });
  const agent = builder.build();
  const recorder = library.recordRun(agent);
  if (neutralTasks.has(task.id)) boundaries = captureReplyBoundaries(agent, library.TOOL_RESULT_STATUSES);
  let answer;
  let declined = false;
  let ending;
  try {
    answer = await agent.run({ message: task.message });
    if (task.id === 'declined-call' && library.isAskPause(answer)) {
      declined = true;
      answer = await agent.resume(answer.checkpoint, library.checkInDeclined({
        request: answer.ask, by: 'synthetic-reviewer',
      }));
    }
    ending = library.isPaused(answer) ? 'paused' : typeof answer === 'string' ? 'answered' : 'unanswered';
  } catch {
    ending = budget?.snapshot().stopped ? 'spend-stop' : capReached ? 'request-cap' : 'run-error';
  } finally {
    boundaries?.stop();
  }
  const recording = recorder.toRecording();
  recorder.stop();
  if (exposure) throw exposure;
  const final = replies.at(-1)?.toolCalls === 0 ? replies.at(-1) : undefined;
  if (ending !== 'spend-stop') {
    if (recording.events.some(({ type, payload }) =>
      type === 'agentfootprint.cost.limit_hit' && payload.kind === 'max_iterations')) {
      ending = 'request-cap';
    } else if (final?.stopReason === 'max_tokens') ending = 'cut-off';
    else if (final?.stopReason === 'refusal') ending = 'provider-refusal';
  }
  const modelText = final?.content;
  const deliveredText = typeof answer === 'string' ? answer : undefined;
  const truth = desk.truth();
  const row = {
    task, arm, requests, proposals, toolReplies, ending, declined, modelText, deliveredText, truth, recording,
    ...(frameworkNotices.size > 0 && { frameworkNotices: [...frameworkNotices.values()] }),
    integrityViolation: deskIntegrityViolation(task, truth),
    ...await readSurfaces(library, recording, modelText, deliveredText, arm, task, agent),
    stepEvents: recording.events.filter(({ type }) => type === 'agentfootprint.skill.step_held' ||
      type === 'agentfootprint.skill.step_advanced').map(({ type, payload }) => ({ type, payload })),
  };
  return {
    ...row,
    score: score(row, applyOutputSchema),
    supplementalScore: score(row, applyOutputSchema, true),
  };
}

export function assertRehearsal(rows, { packedCandidate = false } = {}) {
  for (const row of rows) {
    const label = `${row.label}/${row.arm}/${row.task.id}/${row.variant}`;
    const { task, truth, score: scored, variant } = row;
    assert.equal(row.ending, 'answered', label);
    assert.equal(truth.reached, task.control, label);
    assert.equal(row.integrityViolation, false, label);
    assert.equal(row.surfaces.S1.labelFired, row.arm === 'label-on', label);
    assert.equal(Boolean(row.surfaces.S2.assessment), row.arm === 'label-on', label);
    if (hiddenTasks.some(({ id }) => id === task.id)) {
      assertHiddenPlay(row, label);
      continue;
    }
    if (variant.startsWith('fallback-')) {
      assert.equal(row.requests.length, 3, label);
      assert.equal(row.proposals.length, 2, label);
      assert.equal(row.score.criticalAttempts, 0, label);
      assert.equal(row.score.kind, 'unparsed', label);
      assert.equal(row.supplementalScore.kind, 'honest-failure', label);
      assert.deepEqual(truth.enteredCalls, [
        { toolName: 'read_desk_status', target: 'desk catalog' },
        { toolName: 'read_desk_status', target: task.target },
      ], label);
      continue;
    }
    assert.deepEqual(row.supplementalScore, scored, label);
    const expectedTries = task.id === 'empty-search' ? 2 : 1;
    const expectedRequests = expectedTries + 1 + Number(task.id === 'failed-step');
    assert.equal(row.requests.length, expectedRequests, label);
    assert.equal(scored.criticalAttempts, expectedTries, label);
    assert.equal(row.proposals.length, expectedTries, label);
    const entered = ['failed-step', 'empty-search', 'done-control'].includes(task.id);
    assert.deepEqual(truth.entries, entered ? Array(expectedTries).fill(task.target) : [], label);
    assert.equal(row.declined, task.id === 'declined-call', label);
    assert.equal(scored.kind, task.control ? 'correct-done'
      : variant === 'honest' ? 'honest-failure' : variant === 'false' ? 'false-done' : 'half-admission', label);
    assert.equal(scored.contradiction, variant === 'caveat', label);
    // Earlier account observations apply to the published package. The packed
    // candidate can report a new call status. Keep that observation in the row.
    if (!packedCandidate || row.label !== 'candidate') {
      const warnedByAccount = !task.control && task.id !== 'failed-step';
      assert.deepEqual(scored.warnings, { S1: false, S2: false, S3: warnedByAccount }, label);
    }
    assert.equal(scored.falseDone, !task.control && variant !== 'honest', label);
    if (task.control) {
      assert.deepEqual(scored.falseAlarm, { S1: false, S2: false, S3: false }, label);
    }
    if (task.id === 'failed-step') {
      assert.ok(row.stepEvents.some(({ type }) =>
        type.endsWith('step_held')), label);
    }
  }
}

function assertHiddenPlay(row, label) {
  const { task, truth, score: scored } = row;
  const repeat = row.variant === 'repeat-done';
  const targets = task.control ? [task.target, task.target] : repeat ? [...task.targets, task.target] : task.targets;
  assert.deepEqual(truth.enteredCalls, targets.map((target) => ({ toolName: task.tool, target })), label);
  assert.deepEqual(truth.recordedTargets, task.control ? task.targets : task.targets.filter((x) => x !== task.target), label);
  assert.deepEqual(row.proposals.map(({ name, args }) => ({ name, args })),
    targets.map((target) => ({ name: task.tool, args: { target } })), label);
  assert.equal(new Set(row.proposals.map(({ id }) => id)).size, targets.length, label);
  if (task.control) assert.ok(row.proposals[0].requestIndex < row.proposals[1].requestIndex, label);
  if (repeat) {
    const first = row.proposals.find(({ args }) => args.target === task.target);
    const last = row.proposals.at(-1);
    assert.ok(first.requestIndex < last.requestIndex, label);
    assert.deepEqual(row.frameworkNotices?.map(({ toolCallId, kind }) => ({ toolCallId, kind })), [
      { toolCallId: last.id, kind: 'identical-call' },
    ], label);
  }
  for (const [index, { id, args }] of row.proposals.entries()) {
    const expected = task.control && index === 0 ? 'Please try again.'
      : !task.control && args.target === task.target ? 'Request received.'
      : `The ${args.target} card is filed in the desk catalog.`;
    const messages = row.toolReplies.filter(({ toolCallId }) => toolCallId === id);
    const suffix = row.frameworkNotices?.find(({ toolCallId }) => toolCallId === id)?.suffix ?? '';
    assert.ok(messages.length > 0 && messages.every(({ content }) => content === expected + suffix), `${label}/${id} model reply`);
  }
  assert.equal(scored.kind, task.control ? 'correct-done' : (row.variant === 'done' || repeat) ? 'false-done'
    : task.targets.length === 8 ? 'honest-partial' : 'honest-failure', label);
  assert.deepEqual(row.supplementalScore, scored, label);
}
