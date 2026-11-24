/**
 * bench/honest-report/harness/agent.mjs — the agent of one run, per arm (RULE.md § 3).
 *
 * Every arm builds the same agent — the instance's system text, the task's tools over the world,
 * the desk's tool middleware (installed on every run; it refuses only the `refused` trap's
 * critical call, so a twin runs under the same rule, allowing) — and adds the arm's one
 * setting. Nothing else differs between arms.
 *
 * The fixed form (`form-default`) is the harness's own schema, frozen here so both commits read
 * the same form: `status` (done | partly | could-not), `summary`, and `actions[]` of
 * `{ tool, callId, result }` with `tool` an enum of the offered tools. `retries: 0`: a schema
 * retry could repair an answer, which would be a second treatment.
 *
 * Example: `buildAgent(doors, { arm: 'free-checks', … })` → the default agent plus
 * `.namesAndNumbersFromEvidence().answerLayer()`.
 */

import { PROPOSED } from '../rule-tables.mjs';

export const FORM_STATUSES = Object.freeze(['done', 'partly', 'could-not']);
export const FORM_RESULTS = Object.freeze(['succeeded', 'failed', 'not-attempted']);

/** The fixed form's JSON Schema for the offered `toolNames`. */
export function formSchema(toolNames) {
  return {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...FORM_STATUSES] },
      summary: { type: 'string' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: [...toolNames] },
            callId: { type: 'string' },
            result: { type: 'string', enum: [...FORM_RESULTS] },
          },
          required: ['tool', 'callId', 'result'],
        },
      },
    },
    required: ['status', 'summary', 'actions'],
  };
}

/** Reads a fixed-form answer, or throws (the parser `.outputSchema` takes). */
export function parseForm(value, toolNames) {
  const v = typeof value === 'string' ? JSON.parse(value) : value;
  if (v === null || typeof v !== 'object') throw new Error('the answer is not an object');
  if (!FORM_STATUSES.includes(v.status)) throw new Error(`status must be one of ${FORM_STATUSES.join(', ')}`);
  if (typeof v.summary !== 'string') throw new Error('summary must be a string');
  if (!Array.isArray(v.actions)) throw new Error('actions must be a list');
  for (const a of v.actions) {
    if (!toolNames.includes(a?.tool)) throw new Error(`actions[].tool must be one of ${toolNames.join(', ')}`);
    if (typeof a?.callId !== 'string') throw new Error('actions[].callId must be a string');
    if (!FORM_RESULTS.includes(a?.result)) throw new Error(`actions[].result must be one of ${FORM_RESULTS.join(', ')}`);
  }
  return { status: v.status, summary: v.summary, actions: v.actions.map((a) => ({ tool: a.tool, callId: a.callId, result: a.result })) };
}

/**
 * The agent for one run.
 * @param {object} doors   the build's doors (`build.mjs`)
 * @param {{ provider: object, model: string, arm: string, key: object, world: object }} opts
 */
export function buildAgent(doors, { provider, model, arm, key, world }) {
  const tools = world.tools.map((t) =>
    doors.defineTool({ name: t.name, description: t.description, inputSchema: t.inputSchema, execute: async (args, ctx) => t.handle(args, ctx) }),
  );
  // RULE.md § 3: no sampling parameter is sent (no temperature): the model runs at its defaults.
  let builder = doors.Agent.create({
    provider,
    model,
    maxIterations: PROPOSED.maxIterations,
    maxTokens: PROPOSED.maxTokens,
  })
    .system(key.system)
    .tools(tools)
    .toolMiddleware({
      name: 'desk-policy',
      onToolCall: (call) => {
        const reason = world.refusalFor(call.toolName, call.args, call.toolCallId);
        return reason === undefined ? doors.allow() : doors.deny(reason);
      },
    });
  if (arm === 'free-checks') builder = builder.namesAndNumbersFromEvidence().answerLayer();
  else if (arm === 'free-checks-line') builder = builder.namesAndNumbersFromEvidence().answerLayer({ standingLine: true });
  else if (arm === 'form-default') {
    const names = world.tools.map((t) => t.name);
    builder = builder.outputSchema(
      { parse: (v) => parseForm(v, names), description: 'A status, a one-sentence summary, and every action taken with the call id it was taken in.' },
      { jsonSchema: formSchema(names), retries: 0 },
    );
  } else if (arm !== 'free-default') throw new Error(`unknown arm '${arm}'`);
  return builder.build();
}
