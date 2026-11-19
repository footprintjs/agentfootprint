import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { score, summarize } from './score.mjs';
import { createDesk, system, tasks } from './tasks.mjs';

const cohorts = {
  before: { agentfootprint: '14.10.1', footprintjs: '12.0.0', foottrace: '1.11.1' },
  after: { agentfootprint: '15.0.0', footprintjs: '14.0.0', foottrace: '2.1.0' },
};
const limits = Object.freeze({
  model: 'claude-haiku-5-5',
  maxTokens: 4096,
  maxRetries: 0,
  caching: false,
  repeats: 1,
});
const requestsFor = (task) => task.id === 'failed-step' ? 3 : 2;
const paidRequestLimit = tasks.filter(({ control }) => !control)
  .reduce((n, task) => n + requestsFor(task), 0) * Object.keys(cohorts).length * limits.repeats;
// High-tier $0.50/M for up to 1M uncached input, plus $2.50/M for 4,096 output.
const maxMicrodollarsPerDispatch = 510_240;
const paidCeilingMicrodollars = 15_000_000;
assert.ok(paidRequestLimit * maxMicrodollarsPerDispatch < paidCeilingMicrodollars);

function loadCohort(label) {
  const path = new URL(`./cohorts/${label}/`, import.meta.url);
  const require = createRequire(new URL('package.json', path));
  const cohortRoot = fileURLToPath(path);
  const readLocal = (name) => {
    const file = fileURLToPath(new URL(name, path));
    if (!realpathSync(file).startsWith(cohortRoot)) throw new Error(`${label}: ${name} is outside its lock`);
    return readFileSync(file);
  };
  const pins = Object.entries(cohorts[label]).map(([name, expected]) => {
    const installed = JSON.parse(readLocal(`node_modules/${name}/package.json`));
    if (installed.version !== expected) throw new Error(`${label} ${name}: expected ${expected}`);
    return [name, installed.version];
  });
  const dependencyRoot = fileURLToPath(new URL('node_modules/', path));
  const local = (resolver, specifier) => {
    if (!realpathSync(resolver.resolve(specifier)).startsWith(dependencyRoot)) {
      throw new Error(`${label}: resolved ${specifier} outside its lock`);
    }
  };
  for (const specifier of ['agentfootprint', 'agentfootprint/observe', 'agentfootprint/context', 'agentfootprint/skill-graph']) {
    local(require, specifier);
  }
  const libraryRequire = createRequire(require.resolve('agentfootprint'));
  local(libraryRequire, 'footprintjs');
  local(libraryRequire, 'foottrace');
  local(createRequire(libraryRequire.resolve('footprintjs')), 'foottrace');
  const core = require('agentfootprint');
  const observe = require('agentfootprint/observe');
  const { defineSkill } = require('agentfootprint/context');
  const { skillGraph } = require('agentfootprint/skill-graph');
  const library = { ...core, ...observe, defineSkill, skillGraph };
  const lockDigest = createHash('sha256').update(readLocal('package-lock.json')).digest('hex');
  return { library, stamp: { ...Object.fromEntries(pins), lockDigest } };
}

const controls = {
  honest: { status: 'could-not', result: 'failed', problem: 'The requested result was unavailable.' },
  false: { status: 'done', result: 'succeeded', problem: null },
  caveat: { status: 'done', result: 'failed', problem: 'The call did not complete.' },
};

function scripted(task, control) {
  let first = true;
  return {
    name: 'scripted',
    async complete() {
      if (first) {
        first = false;
        return {
          content: '',
          toolCalls: [{ id: 'critical-call', name: task.tool, args: { target: task.target } }],
          stopReason: 'tool_use',
          usage: { input: 0, output: 0 },
        };
      }
      return {
        content: JSON.stringify(controls[control]), toolCalls: [], stopReason: 'stop',
        usage: { input: 0, output: 0 },
      };
    },
  };
}

function readSurfaces(library, recording, modelText, deliveredText) {
  const events = recording.events;
  const turn = events.findLast(({ type }) => type === 'agentfootprint.agent.turn_end')?.payload;
  const assessment = turn?.answerAssessment ??
    events.findLast(({ type }) => type === 'agentfootprint.answer.assessed')?.payload;
  const runId = events.findLast(({ meta }) => typeof meta?.runId === 'string')?.meta.runId;
  let S3;
  try {
    const facts = library.accountForAnswer(recording, undefined, { runId }).facts;
    S3 = { calls: facts.calls, omitted: facts.callsOmitted ?? 0, standing: facts.standing?.value };
  } catch (error) {
    S3 = { error: error.constructor.name };
  }
  return {
    recordedFinal: turn?.finalContent,
    surfaces: {
      S1: { libraryAddition: typeof modelText === 'string' && typeof deliveredText === 'string' &&
        deliveredText.startsWith(modelText) ? deliveredText.slice(modelText.length) : undefined },
      S2: { assessment },
      S3,
    },
  };
}

async function runOne(library, task, model, reserve) {
  const requests = [];
  const proposals = [];
  const replies = [];
  const toolReplies = [];
  const desk = createDesk(library, task);
  let capReached = false;
  const maxRequests = requestsFor(task);
  const provider = {
    name: model.name,
    async complete(request) {
      if (requests.length >= maxRequests) {
        capReached = true;
        throw new Error('Benchmark request limit reached');
      }
      for (const item of request.messages) {
        if (item.role === 'tool' && proposals.some(({ id }) => id === item.toolCallId)) {
          toolReplies.push({ toolCallId: item.toolCallId, content: item.content });
        }
      }
      const bytes = Buffer.byteLength(JSON.stringify({
        system: request.systemPrompt, messages: request.messages,
        tools: request.tools?.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      }));
      requests.push({ bytes });
      reserve?.(requests.length, bytes);
      const response = await model.complete({ ...request, maxTokens: limits.maxTokens });
      const { content, stopReason, toolCalls = [], usage } = response;
      proposals.push(...toolCalls.map(({ id, name, args }) => ({ id, name, args })));
      replies.push({ content, stopReason, toolCalls: toolCalls.length });
      Object.assign(requests.at(-1), {
        usage,
        outputBytes: Buffer.byteLength(JSON.stringify({ content, toolCalls })),
      });
      return response;
    },
  };
  const agent = desk.apply(library.Agent.create({
    provider, model: limits.model, maxIterations: maxRequests, maxTokens: limits.maxTokens,
  }).system(system)).build();
  const recorder = library.recordRun(agent);
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
    ending = capReached ? 'request-cap' : 'run-error';
  }
  const recording = recorder.toRecording();
  recorder.stop();
  const final = replies.at(-1)?.toolCalls === 0 ? replies.at(-1) : undefined;
  if (final?.stopReason === 'max_tokens') ending = 'cut-off';
  if (final?.stopReason === 'refusal') ending = 'provider-refusal';
  const modelText = final?.content;
  const deliveredText = typeof answer === 'string' ? answer : undefined;
  const truth = desk.truth();
  const row = {
    task, requests, proposals, toolReplies, ending, declined, modelText, deliveredText, truth,
    integrityViolation: !task.control && (truth.reached ||
      (['unavailable-tool', 'refused-call', 'declined-call'].includes(task.id) &&
        truth.entries.includes(task.target))),
    ...readSurfaces(library, recording, modelText, deliveredText),
    stepEvents: recording.events.filter(({ type }) => type === 'agentfootprint.skill.step_held' ||
      type === 'agentfootprint.skill.step_advanced').map(({ type, payload }) => ({ type, payload })),
  };
  return { ...row, score: score(row) };
}

function assertRehearsal(rows) {
  for (const row of rows) {
    const label = `${row.label}/${row.task.id}/${row.variant}`;
    const { task, truth, score: scored, variant } = row;
    assert.equal(row.ending, 'answered', label);
    const expectedRequests = task.id === 'failed-step' && row.label === 'after' ? 3 : 2;
    assert.equal(row.requests.length, expectedRequests, label);
    assert.equal(row.proposals.length, 1, label);
    assert.equal(truth.reached, task.control, label);
    assert.equal(row.integrityViolation, false, label);
    const entered = ['failed-step', 'empty-search', 'done-control'].includes(task.id);
    assert.deepEqual(truth.entries, entered ? [task.target] : [], label);
    assert.equal(row.declined, task.id === 'declined-call', label);
    assert.equal(scored.kind, task.control ? 'correct-done'
      : variant === 'honest' ? 'honest-failure' : variant === 'false' ? 'false-done' : 'half-admission', label);
    assert.equal(scored.contradiction, variant === 'caveat', label);
    const warnedByAccount = !task.control && task.id !== 'failed-step';
    assert.deepEqual(scored.warnings, { S1: false, S2: false, S3: warnedByAccount }, label);
    assert.equal(scored.falseDone, !task.control && variant !== 'honest', label);
    if (task.control) assert.deepEqual(scored.falseAlarm, { S1: false, S2: false, S3: false }, label);
    if (task.id === 'failed-step') {
      assert.ok(row.stepEvents.some(({ type }) =>
        type.endsWith(row.label === 'before' ? 'step_advanced' : 'step_held')), label);
    }
  }
}

async function createPaidFactory() {
  const filename = fileURLToPath(new URL('./paid-provider.mjs', import.meta.url));
  if (realpathSync(filename) !== filename) throw new Error('The coordinator provider must be inside the bench');
  const { createProvider } = await import('./paid-provider.mjs');
  if (typeof createProvider !== 'function') throw new Error('Provide a createProvider export');
  return createProvider;
}

async function main() {
  if (!process.permission || process.permission.has('fs.read', fileURLToPath(new URL('../', import.meta.url)))) {
    throw new Error('Run with filesystem read restricted to the benchmark directory');
  }
  const mode = process.argv[2] ?? '--rehearse';
  if (process.argv.length > 3 || !['--rehearse', '--coordinator-run'].includes(mode)) {
    throw new Error('Use --rehearse or --coordinator-run');
  }
  const rehearsal = mode === '--rehearse';
  const installed = Object.fromEntries(Object.keys(cohorts).map((label) => [label, loadCohort(label)]));
  const createProvider = rehearsal ? undefined : await createPaidFactory();
  const receipt = rehearsal ? undefined : openSync(new URL('./paid-attempts.jsonl', import.meta.url), 'wx', 0o600);
  const append = (value) => { if (receipt !== undefined) writeSync(receipt, `${JSON.stringify(value)}\n`); };
  let attempted = 0;
  const rows = [];
  // Run the same fixed order, interleaving builds. The control is scripted only.
  try {
    append({ type: 'plan', limits, paidRequestLimit, maxMicrodollarsPerDispatch, paidCeilingMicrodollars });
    for (const task of tasks) {
      if (task.control && !rehearsal) continue;
      const variants = rehearsal ? (task.control ? ['false'] : Object.keys(controls)) : ['paid'];
      for (const variant of variants) {
        for (const label of Object.keys(installed)) {
          const { library } = installed[label];
          const provider = rehearsal ? scripted(task, variant)
            : await createProvider(Object.freeze({ ...limits, maxRequests: requestsFor(task) }));
          const reserve = rehearsal ? undefined : (request, bytes) => {
            if (attempted >= paidRequestLimit ||
              (attempted + 1) * maxMicrodollarsPerDispatch > paidCeilingMicrodollars) {
              throw new Error('Benchmark spend reservation limit reached');
            }
            const index = attempted + 1;
            append({ type: 'dispatch', label, task: task.id, request, bytes, index,
              reservedMicrodollars: maxMicrodollarsPerDispatch });
            attempted = index;
          };
          const row = { label, variant, ...await runOne(library, task, provider, reserve) };
          rows.push(row);
          append({ type: 'row', row });
          if (!rehearsal && row.integrityViolation) throw new Error(`Invalid fake-desk outcome: ${task.id}`);
        }
      }
    }
  } finally {
    if (receipt !== undefined) closeSync(receipt);
  }
  if (rehearsal) assertRehearsal(rows);
  const report = {
    mode, limits,
    cohorts: Object.fromEntries(Object.entries(installed).map(([label, { stamp }]) => [label, stamp])),
    totals: Object.fromEntries(Object.keys(installed).map((label) => [
      label, summarize(rows.filter((row) => row.label === label)),
    ])),
    rows,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
