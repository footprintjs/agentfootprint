/**
 * lib/mcp/elicitation — a typed ask carried as an MCP elicitation, and the
 * elicitation's answer carried back (time design § 6.1).
 *
 * Pattern: Adapter, pure, both directions in one file so they cannot drift.
 *          `elicitationOf` maps a pending `AwaitingInput` onto the MCP
 *          elicitation request (`message` + a flat `requestedSchema` of
 *          primitive properties, the MCP specification revision of
 *          2025-06-18); `answerFromElicitation` maps the client's `content`
 *          back to the `InputResponse` `agent.resume` takes. Nothing is
 *          checked here that the resume door checks: the answer goes through
 *          `core/inputRequest.ts` · `applyInputResponse` like any other, and a
 *          refused time answer comes back as a re-ask to elicit again.
 * Role:    lib/mcp (the transport). Reads `core/inputRequest.ts` types only.
 * Emits:   N/A.
 *
 * ## The mapping
 *
 * MCP's elicitation schema holds strings (with a `format` of `date-time`
 * among a few), numbers, booleans and string choices (`enum` + `enumNames`).
 * It has no range, so a time field becomes the properties a person can fill:
 *
 * | Field | Properties |
 * |-------|------------|
 * | `string` / `number` / `boolean` | `<id>`, as typed; a string's `enum` with its `labels` as `enumNames` |
 * | `format: 'instant'` | `<id>`: `{ type: 'string', format: 'date-time' }` |
 * | `format: 'zone'` | `<id>`: a string |
 * | `format: 'time-range'` | `<id>.from` and `<id>.to`: two `date-time` strings, joined back as `from/to` |
 * | a `format` field with choices | `<id>`: the choices, labelled; unless `strict`, ALSO the free-entry properties above (`<id>.other` for an instant or a zone) — answer one or the other |
 *
 * Only the fields still open are asked (a supplied value is known). A
 * property is `required` only when it is the one way to answer a missing
 * field. A number or boolean with `enum` has no MCP spelling and is refused,
 * never widened; so is a field id that collides with a generated name.
 *
 * @example
 * ```ts
 * const out = await agent.run({ message });
 * if (isInputPause(out)) {
 *   const request = elicitationOf(out.awaitingInput);
 *   const reply = await mcpClientSession.elicit(request); // { action: 'accept', content }
 *   if (reply.action === 'accept')
 *     await agent.resume(out.checkpoint, answerFromElicitation(out.awaitingInput, reply.content));
 * }
 * ```
 */

import {
  InputRequestError,
  type AwaitingInput,
  type InputField,
  type InputResponse,
  type InputValue,
} from '../../core/inputRequest.js';

/** One primitive property of an elicitation's `requestedSchema`. */
export type ElicitationProperty =
  | {
      readonly type: 'string';
      readonly description?: string;
      readonly format?: 'date-time';
      readonly enum?: readonly string[];
      readonly enumNames?: readonly string[];
    }
  | { readonly type: 'number'; readonly description?: string }
  | { readonly type: 'boolean'; readonly description?: string };

/** The MCP `elicitation/create` request's params. */
export interface ElicitationRequest {
  readonly message: string;
  readonly requestedSchema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, ElicitationProperty>>;
    readonly required?: readonly string[];
  };
}

/** How one field travels: its choice property, its free-entry properties, and which are required. */
interface Carriage {
  readonly choice?: string;
  readonly entry: readonly string[];
}

const own = (o: object, k: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(o, k);

function fail(reason: string): never {
  throw new InputRequestError(reason);
}

function carriageOf(field: InputField): Carriage {
  const id = field.id;
  if (field.enum === undefined) {
    return { entry: field.format === 'time-range' ? [`${id}.from`, `${id}.to`] : [id] };
  }
  if (field.format === undefined || field.strict === true) return { choice: id, entry: [] };
  // A time field's choices keep free entry open (time design § 6.1): both ways travel.
  return {
    choice: id,
    entry: field.format === 'time-range' ? [`${id}.from`, `${id}.to`] : [`${id}.other`],
  };
}

function entryProperty(field: InputField): ElicitationProperty {
  const description = field.description !== undefined ? { description: field.description } : {};
  if (field.type === 'number') return { type: 'number', ...description };
  if (field.type === 'boolean') return { type: 'boolean', ...description };
  if (field.format === 'instant' || field.format === 'time-range')
    return { type: 'string', format: 'date-time', ...description };
  return { type: 'string', ...description };
}

function choiceProperty(field: InputField): ElicitationProperty {
  if (field.type !== 'string') {
    fail(`field '${field.id}': an MCP elicitation carries choices of strings only`);
  }
  return {
    type: 'string',
    ...(field.description !== undefined && { description: field.description }),
    enum: (field.enum ?? []).map(String),
    ...(field.labels !== undefined && { enumNames: [...field.labels] }),
  };
}

/** The fields still open — a supplied value is known and not asked again. */
const openFields = (awaiting: AwaitingInput): readonly InputField[] =>
  awaiting.fields.filter((f) => !own(awaiting.supplied, f.id));

/**
 * The MCP elicitation for a pending typed ask: its question (after the
 * refusal's reason, on a re-ask) and one property per way to answer each open
 * field. Throws `InputRequestError` on a field MCP cannot carry.
 */
export function elicitationOf(awaiting: AwaitingInput): ElicitationRequest {
  const properties: Record<string, ElicitationProperty> = {};
  const required: string[] = [];
  const ids = new Set(awaiting.fields.map((f) => f.id));
  const place = (name: string, property: ElicitationProperty, owner: string): void => {
    if (own(properties, name) || (name !== owner && ids.has(name))) {
      fail(`field '${owner}': the elicitation property '${name}' collides with another field`);
    }
    properties[name] = property;
  };
  for (const field of openFields(awaiting)) {
    const carriage = carriageOf(field);
    if (carriage.choice !== undefined) place(carriage.choice, choiceProperty(field), field.id);
    for (const name of carriage.entry) place(name, entryProperty(field), field.id);
    // Required only when there is ONE way to answer: a choice with free entry is either-or.
    if (
      awaiting.missing.includes(field.id) &&
      (carriage.choice === undefined) !== (carriage.entry.length === 0)
    ) {
      required.push(...(carriage.choice !== undefined ? [carriage.choice] : carriage.entry));
    }
  }
  const message =
    awaiting.refused !== undefined
      ? `${awaiting.refused.reason}\n\n${awaiting.question}`
      : awaiting.question;
  return {
    message,
    requestedSchema: {
      type: 'object',
      properties,
      ...(required.length > 0 && { required }),
    },
  };
}

function primitive(name: string, value: unknown): InputValue {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fail(`the elicitation's '${name}' is not a string, number or boolean`);
}

/**
 * The `InputResponse` an accepted elicitation's `content` names — each open
 * field's value, a time range's two properties joined as `from/to`. Throws
 * `InputRequestError` on a property the elicitation did not ask, on a choice
 * AND a free entry for one field, and on half a range. The values are judged
 * by `agent.resume`, as any answer is.
 */
export function answerFromElicitation(awaiting: AwaitingInput, content: unknown): InputResponse {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    fail("the elicitation's content must be an object");
  }
  const given = content as Record<string, unknown>;
  const asked = new Set<string>();
  const values: Record<string, InputValue> = {};
  for (const field of openFields(awaiting)) {
    const carriage = carriageOf(field);
    const names = [...(carriage.choice !== undefined ? [carriage.choice] : []), ...carriage.entry];
    names.forEach((n) => asked.add(n));
    const chosen = carriage.choice !== undefined && own(given, carriage.choice);
    const entered = carriage.entry.filter((n) => own(given, n));
    if (chosen && entered.length > 0) {
      fail(`field '${field.id}': answer with a choice or your own value, not both`);
    }
    let value: InputValue | undefined;
    if (chosen) value = primitive(carriage.choice as string, given[carriage.choice as string]);
    else if (field.format === 'time-range' && entered.length > 0) {
      if (entered.length !== 2)
        fail(`field '${field.id}': a time range needs its start and its end`);
      value = `${primitive(`${field.id}.from`, given[`${field.id}.from`])}/${primitive(
        `${field.id}.to`,
        given[`${field.id}.to`],
      )}`;
    } else if (entered.length === 1)
      value = primitive(entered[0] as string, given[entered[0] as string]);
    if (value !== undefined) {
      Object.defineProperty(values, field.id, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  const unasked = Object.keys(given).filter((k) => !asked.has(k));
  if (unasked.length > 0)
    fail(`the elicitation's content names properties it did not ask: ${unasked.join(', ')}`);
  return { requestId: awaiting.requestId, values };
}
