/**
 * bench/honest-report/harness/one-run.mjs — one run: an (instance, arm, build, repetition), and
 * the raw record the scorer reads (RULE.md § 1, § 5, § 7, § 12).
 *
 * What a raw record keeps, apart: the model's own text (`modelText`, the text of its last
 * response with no tool calls, from the HARNESS's own record of the replies, never from the
 * library's events, which are kept only as a cross-check, `eventModelText`) and the delivered
 * text (`deliveredText`, what `run()` returned);
 * the world's end state (truth, per-target reached, its call log); the critical call ids, found
 * in the world's log (the harness's, not the library's); the three surfaces' facts; the ending;
 * the usage; and the FULL recording (`recordRun(agent).toRecording()`, nothing dropped), so a
 * later build can read the same run again.
 *
 * Example: `await runOne({ build, key, task, arm: 'free-default', rep: 0, provider: 'scripted' })`
 * → `{ runKey: 'A/free-default/open/restart-service/throws/trap/neutral/r0', ending: 'answered', … }`.
 */

import { digest, usageOf } from '../../inputs/harness.mjs';
import { warningTableFor } from '../rule-tables.mjs';
import { createWorld } from '../tasks/world.mjs';
import { buildAgent, parseForm } from './agent.mjs';
import { buildStamp } from './build.mjs';
import { costOfReplies } from './cost.mjs';
import { endingOf, httpStatusOf, textMismatchOf } from './endings.mjs';
import { modelTextFromReplies } from './provider.mjs';
import { scriptedModel } from './scripted-model.mjs';
import { readSurfaces } from './surfaces.mjs';

export const RAW_SCHEMA = 'honest-report/raw@2';

const LLM_END = 'agentfootprint.stream.llm_end';
const UNMET = 'agentfootprint.agent.output_contract_unmet';

export function runKeyOf(buildLabel, arm, instanceId, rep) {
  return `${buildLabel}/${arm}/${instanceId}/r${rep}`;
}

/** The file a raw record is saved under: ids are `[A-Za-z0-9._-]` between slashes, so `__` is injective. */
export function rawFileName(runKey) {
  if (runKey.includes('__')) throw new Error(`run key ${runKey} holds "__"`);
  return `${runKey.split('/').join('__')}.json.gz`;
}

/** The library's events' account of the model's final text: the cross-check of RULE.md § 4. */
export function modelTextOf(events) {
  const last = [...events].reverse().find((e) => e.type === LLM_END && (e.payload?.toolCallCount ?? 0) === 0);
  return last?.payload?.content;
}

/** The critical calls' ids, from the world's own log (RULE.md § 7: the harness finds them). */
export function criticalIdsOf(key, log) {
  return [...new Set(log.filter((l) => key.critical.some((c) => c.stage === l.stage && c.targetIndex === l.targetIndex)).map((l) => l.toolCallId))].filter(Boolean);
}

/**
 * @param {object} o
 * @param {object} o.build       a loaded build (`build.mjs`)
 * @param {object} o.key         the instance key
 * @param {object} o.task        its base task
 * @param {string} o.arm
 * @param {number} o.rep
 * @param {number} [o.round]     the plan's round (RULE.md § 8)
 * @param {'scripted'|'anthropic'} o.provider
 * @param {string} [o.model]     the model id (anthropic)
 * @param {(doors, served) => object} [o.wire]  builds the anthropic provider over the SDK (`provider.mjs`)
 * @param {object} [o.behaviour]  scripted only: pins the scripted behaviour (tests, the probe)
 * @param {object} [o.table]      the warning table to read the surfaces through; default: the build's
 *                                (the probe passes one that names no source, for a commit with no table yet)
 */
export async function runOne({ build, key, task, arm, rep, round = rep, provider: kind, model, wire, behaviour, table = warningTableFor(build.commit) }) {
  const { doors } = build;
  if (table === undefined) throw new Error(`build ${build.label} is commit ${String(build.commit).slice(0, 8)}: no warning table (RULE.md § 7)`);
  const world = createWorld(key, task);
  let provider;
  let scripted;
  let served;
  if (kind === 'scripted') {
    scripted = scriptedModel(doors, { key, task, arm, rep, behaviour });
    provider = scripted.provider;
  } else {
    served = { requests: [] };
    provider = wire(doors, served);
  }
  const agentModel = kind === 'scripted' ? 'mock' : model;
  const agent = buildAgent(doors, { provider, model: agentModel, arm, key, world });
  const recorder = doors.recordRun(agent);
  const started = Date.now();
  let out;
  let threw;
  try {
    out = await agent.run({ message: key.message });
  } catch (err) {
    threw = err;
  }
  const durationMs = Date.now() - started;
  const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
  recorder.stop();
  const events = recording.events ?? [];
  const state = recording.snapshot?.sharedState ?? {};
  const llmEnds = events.filter((e) => e.type === LLM_END);
  const replies = kind === 'scripted' ? scripted.replies : served.requests;
  const modelText = modelTextFromReplies(replies);
  const eventModelText = modelTextOf(events);
  const deliveredText = typeof out === 'string' ? out : undefined;
  const mismatch = textMismatchOf({ wrapperText: modelText, eventText: eventModelText, deliveredText });
  const end = world.endState();
  const criticalIds = criticalIdsOf(key, end.log);
  let form;
  if (arm === 'form-default' && typeof modelText === 'string') {
    try {
      form = parseForm(modelText, world.tools.map((t) => t.name));
    } catch {
      form = undefined;
    }
  }
  const ending = endingOf({
    threw,
    paused: threw === undefined && typeof out !== 'string',
    lastStopReason: llmEnds[llmEnds.length - 1]?.payload?.stopReason,
    state,
    formUnmet: arm === 'form-default' && (events.some((e) => e.type === UNMET) || form === undefined),
    textMismatch: mismatch !== undefined,
  });
  const usage = usageOf(events);
  const httpStatus = threw === undefined ? undefined : httpStatusOf(threw);
  return {
    schema: RAW_SCHEMA,
    runKey: runKeyOf(build.label, arm, key.id, rep),
    instanceId: key.id,
    arm,
    rep,
    round,
    build: buildStamp(build),
    provider: kind,
    model: agentModel,
    // RULE.md § 3: the digests of every text the model reads, so a changed word shows on the record.
    digests: { system: digest(key.system), message: digest(key.message), tools: digest(world.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))) },
    servedModels: served?.requests.map((r) => r.servedModel) ?? [],
    attempts: served?.requests.map((r) => r.attempts) ?? [],
    replyUsage: served?.requests.map((r) => r.usage) ?? [],
    ...(scripted !== undefined && { scripted: { behaviour: scripted.behaviour, tokens: scripted.tokens } }),
    ending,
    ...(threw !== undefined && { error: String(threw?.message ?? threw) }),
    ...(httpStatus !== undefined && { httpStatus }),
    modelText,
    eventModelText,
    ...(mismatch !== undefined && { textMismatch: mismatch }),
    deliveredText,
    ...(form !== undefined && { form }),
    endState: end,
    criticalIds,
    engaged: criticalIds.length > 0,
    surfaces: readSurfaces(doors, recording, { deliveredText, modelText, lineArmed: arm === 'free-checks-line', table }),
    usage,
    usd: kind === 'scripted' ? 0 : costOfReplies(served.requests, model),
    durationMs,
    recording,
  };
}
