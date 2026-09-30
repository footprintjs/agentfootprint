import { readAbsence } from './agent/coverage/absent.js';
import type { ToolAbsence } from './agent/coverage/types.js';
import {
  checkTimeAnswer,
  isTimeFormat,
  refusalReason,
  type TimeAnswerRefusal,
  type TimeAskMessages,
  type TimeFormat,
} from './time/ask.js';
import type { ZoneName } from './time/zone.js';
import { defaultTimeAskMessages } from '../locales/timeAsk.js';

/** Typed missing-input values. Collection is distinct from permission or consent. */
export type InputValue = string | number | boolean;
export interface InputField {
  readonly id: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly required?: boolean;
  readonly description?: string;
  readonly enum?: readonly InputValue[];
  /**
   * A TIME field (time design § 6.1): the library checks the answer before the
   * app sees it. `'instant'` — an ISO 8601 date-time with its offset
   * (`2026-10-09T08:00-07:00`); `'time-range'` — an ISO 8601 interval
   * `from/to` of two such instants, `from` before `to`; `'zone'` — an IANA
   * zone name. The value stays a string on the wire, so refused unless
   * `type: 'string'`. An answer that fails the check is not taken: the resume
   * door asks again with `refused: { answer, reason }` (the reason a catalog
   * sentence, `defaultTimeAskMessages`) and `repeat: { count }`, and nothing
   * runs. A choice or a supplied value that fails it is refused at definition.
   */
  readonly format?: TimeFormat;
  /**
   * One label per `enum` choice, in its order — what a person reads beside
   * the value (`'Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT'`); the value is what the
   * answer carries. Needs `enum`.
   */
  readonly labels?: readonly string[];
  /**
   * A time field's choices are the only answers. Without it a `format` field
   * with `enum` keeps free entry open: any answer the format check takes is
   * taken. Needs `format` and `enum`.
   */
  readonly strict?: boolean;
}
export interface InputRequestDeclaration {
  readonly id: string;
  readonly question: string;
  readonly fields: readonly InputField[];
  /** Values the collection tool already knows; never labelled as a person's answer. */
  readonly supplied?: Readonly<Record<string, InputValue>>;
  /** Opaque JSON authored by the collecting tool, never editable by the reply. */
  readonly context?: Readonly<Record<string, unknown>>;
  /**
   * What the tool LOOKED AT before it asked (9.114.0): the envelope `absent()`
   * returns, when a lookup found nothing and raises this request about the
   * miss. Recognized at raise time by the one recognizer
   * (`agent/coverage/absent.ts` · `readAbsence`) — anything it does not read
   * is refused, and `null` is the field omitted — and filed by the dispatch
   * door at the raise, before the
   * checkpoint is returned: the same `tools.absent` event and
   * `coverageDeclared` row a RETURNED absence files
   * (`agent/stages/toolCalls.ts` · `declareRaisedAbsence`). Data for the
   * record, not for the ask: it never rides the awaiting-input shape or the
   * paused call's served result, and nothing on resume reads it, so the
   * pending question says the miss only if `question` says it in words.
   * Under `.limitsTravelWithTheAnswer()` the final answer's limits block
   * carries it, as it does a returned miss.
   */
  readonly absence?: ToolAbsence;
  /**
   * The previous answer to this ask was REFUSED, and why: the app
   * validated what the person gave, turned it down, and asks again. Carried
   * on the awaiting-input shape the person receives — the checkpoint's
   * `pauseData`, the pause outcome, the `pause.request` event — so a UI can
   * say "Your answer '…' was not accepted: <reason>" instead of repeating
   * the same question in silence. The reason is the APP'S words — with one
   * exception the app arms itself: a time field's answer the library's check
   * refused (`InputField.format`), whose reason is a catalog sentence the app
   * can override (`defaultTimeAskMessages`, `.time({ messages })`). `answer`
   * is optional and judged against `fields` like any answer; `null` is the
   * field omitted.
   */
  readonly refused?: InputRefusal;
}
/** An app's refusal of the previous answer to the same ask — see `InputRequestDeclaration.refused`. */
export interface InputRefusal {
  /** The refused values, field id → value, as the person gave them. */
  readonly answer?: Readonly<Record<string, InputValue>>;
  /** Why it was refused, in the app's own words — or, for a time field the library checked, its catalog's (non-blank, at most 4096 characters). */
  readonly reason: string;
}
/**
 * The runtime's mark on a RE-ASK: the same ask (same declaration
 * `id`) raised again in the same turn after the person answered it. Facts
 * only — never a reason. Stamped by the runtime, never declarable.
 */
export interface InputRepeat {
  /** How many times the person has already answered this ask in this turn. */
  readonly count: number;
  /**
   * The person's previous answer (the fields they supplied) as the RECORD
   * holds it — after the tool-result rules, redaction first among them, ran
   * on it. Absent when the record no longer holds it in that shape (a rule
   * replaced the result, placement moved it), never reconstructed.
   */
  readonly previousAnswer?: Readonly<Record<string, InputValue>>;
}
/** The stamped request as the person, the model and the durable pause read it — never the `absence`. */
export interface AwaitingInput extends Omit<InputRequestDeclaration, 'absence'> {
  readonly status: 'awaiting_input';
  /** Runtime-stamped token, distinct from the author's reusable declaration id. */
  readonly requestId: string;
  readonly supplied: Readonly<Record<string, InputValue>>;
  readonly origins: Readonly<Record<string, 'declaration' | 'response'>>;
  readonly missing: readonly string[];
  /** Present only on a re-ask — see `InputRepeat`. */
  readonly repeat?: InputRepeat;
  readonly origin: {
    readonly originalRequest: string;
    /**
     * The call that raised the request. For the inputs layer's own batch ask
     * (`context.agentfootprint.ask === 'arguments'`, honesty layer 2) no single
     * call raised it — the library asked before anything in the batch ran — so
     * this names the batch's FIRST asked call, and `context.agentfootprint.fields`
     * lists every call each field is for.
     */
    readonly toolCallId: string;
    readonly skillId?: string;
    readonly offeredSkillIds?: readonly string[];
  };
}
export interface InputResponse {
  readonly requestId: string;
  readonly values: Readonly<Record<string, InputValue>>;
}
export interface InputCancellation {
  readonly requestId: string;
  readonly cancel: true;
}
/** The dedicated collecting tool's result; it contains inputs, not observations. */
export interface InputResponseResult {
  readonly status: 'input_received';
  readonly requestId: string;
  readonly values: Readonly<Record<string, InputValue>>;
  readonly origins: AwaitingInput['origins'];
  readonly context?: InputRequestDeclaration['context'];
  readonly origin: AwaitingInput['origin'];
}

const own = (o: object, k: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(o, k);
function object(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
}
function jsonValue(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value) && !object(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every((child) => jsonValue(child, seen, depth + 1));
  seen.delete(value);
  return valid;
}
function fail(reason: string): never {
  throw new InputRequestError(reason);
}
/** A malformed or stale data reply; no value was consumed and the ask remains live. */
export class InputRequestError extends TypeError {
  readonly code = 'ERR_INPUT_REQUEST_INVALID' as const;
  constructor(reason: string) {
    super(`[input request] ${reason}. No input was accepted.`);
    this.name = 'InputRequestError';
  }
}
/**
 * A value a typed ask can carry in a field — as a supplied value, a choice or
 * an answer: a non-blank string of at most 4096 characters, a finite number,
 * or a boolean. The one rule, shared by this module's validation and by the
 * declarations that build a typed ask (`agent/arguments/declare.ts` judges an
 * `ask` rule's choices with it at definition).
 */
export function isInputFieldValue(value: unknown): value is InputValue {
  if (typeof value === 'string') return value.trim().length > 0 && value.length <= 4096;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'boolean';
}

/** Whether a field's `enum` is the only answers — always, except a `format` field that is not `strict`. */
const choicesOnly = (field: InputField): boolean =>
  field.format === undefined || field.strict === true;

function validateValues(fields: readonly InputField[], raw: unknown): Record<string, InputValue> {
  if (!object(raw)) fail('values must be an object');
  const values: Record<string, InputValue> = {};
  for (const [id, value] of Object.entries(raw)) {
    const field = fields.find((f) => f.id === id);
    if (!field) fail('values contain an undeclared field');
    if (
      typeof value !== field.type ||
      !isInputFieldValue(value) ||
      (field.enum !== undefined && choicesOnly(field) && !field.enum.includes(value))
    ) {
      fail('a value does not satisfy its declared field type or choices');
    }
    Object.defineProperty(values, id, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return values;
}

const FIELD_KEYS: readonly string[] = [
  'id',
  'type',
  'required',
  'enum',
  'description',
  'format',
  'labels',
  'strict',
];

/**
 * A time field's own rules (time design § 6.1), refused at definition and
 * never repaired: `format` only on a string field; each choice a well-formed
 * value of its format; `labels` one non-blank label per choice; `strict` only
 * where it would change something (a `format` field with choices).
 */
function validateTimeField(field: InputField): void {
  if (field.format !== undefined) {
    if (!isTimeFormat(field.format)) fail("format must be 'instant', 'time-range' or 'zone'");
    if (field.type !== 'string') fail("a format field must be type: 'string'");
    for (const value of field.enum ?? []) {
      if (checkTimeAnswer(field.format, value as string) !== undefined)
        fail(`a choice is not a well-formed ${field.format}`);
    }
  }
  if (field.labels !== undefined) {
    if (
      field.enum === undefined ||
      !Array.isArray(field.labels) ||
      field.labels.length !== field.enum.length ||
      !field.labels.every(nonempty)
    )
      fail('labels must give one non-blank label per enum choice, in its order');
  }
  if (field.strict !== undefined) {
    if (typeof field.strict !== 'boolean') fail('strict must be a boolean');
    if (field.format === undefined || field.enum === undefined)
      fail(
        'strict needs a format field with choices — elsewhere the choices are the only answers already',
      );
  }
}

/** One validation owner, shared by the declaration and durable-pause readers. */
export function validateInputDeclaration(raw: unknown): InputRequestDeclaration {
  if (
    !object(raw) ||
    !nonempty(raw.id) ||
    !nonempty(raw.question) ||
    !Array.isArray(raw.fields) ||
    raw.fields.length < 1 ||
    raw.fields.length > 32
  ) {
    fail('declare an id, question and between one and 32 fields');
  }
  if (
    Object.keys(raw).some(
      (k) => !['id', 'question', 'fields', 'supplied', 'context', 'absence', 'refused'].includes(k),
    )
  )
    fail('unknown declaration field');
  const ids = new Set<string>();
  const fields = raw.fields.map((field: unknown): InputField => {
    if (
      !object(field) ||
      !nonempty(field.id) ||
      ids.has(field.id) ||
      typeof field.type !== 'string' ||
      !['string', 'number', 'boolean'].includes(String(field.type)) ||
      (field.required !== undefined && typeof field.required !== 'boolean') ||
      (field.description !== undefined && !nonempty(field.description)) ||
      Object.keys(field).some((k) => !FIELD_KEYS.includes(k))
    )
      fail('invalid or duplicate input field');
    ids.add(field.id);
    const copy = { ...field } as unknown as InputField;
    if (field.enum !== undefined) {
      if (!Array.isArray(field.enum) || field.enum.length === 0 || field.enum.length > 100)
        fail('enum must contain between one and 100 choices');
      for (const value of field.enum)
        validateValues([{ ...copy, enum: undefined }], { [field.id]: value });
    }
    validateTimeField(copy);
    return {
      id: copy.id,
      type: copy.type,
      ...(copy.required !== undefined && { required: copy.required }),
      ...(copy.description !== undefined && { description: copy.description }),
      ...(copy.enum !== undefined && { enum: [...copy.enum] }),
      ...(copy.format !== undefined && { format: copy.format }),
      ...(copy.labels !== undefined && { labels: [...copy.labels] }),
      ...(copy.strict !== undefined && { strict: copy.strict }),
    };
  });
  const supplied = validateValues(fields, raw.supplied ?? {});
  for (const [id, value] of Object.entries(supplied)) {
    const field = fields.find((f) => f.id === id) as InputField;
    if (field.format !== undefined && checkTimeAnswer(field.format, value as string) !== undefined)
      fail(`a supplied value is not a well-formed ${field.format}`);
  }
  let context: Readonly<Record<string, unknown>> | undefined;
  if (raw.context !== undefined) {
    if (!object(raw.context) || !jsonValue(raw.context)) fail('context must be a JSON object');
    const json = JSON.stringify(raw.context, (_key, value: unknown) => {
      if (
        value === undefined ||
        typeof value === 'function' ||
        typeof value === 'symbol' ||
        typeof value === 'bigint' ||
        (typeof value === 'number' && !Number.isFinite(value))
      )
        fail('context must contain JSON values');
      return value;
    });
    if (json.length > 16384) fail('context exceeds 16384 characters');
    context = JSON.parse(json) as Readonly<Record<string, unknown>>;
  }
  // `null` is the field omitted — the coverage module's rule for a missing
  // optional value (`agent/coverage/absent.ts` · `notGiven`): refusing it
  // would turn a question into a tool error, and it carries no miss to file.
  const absence = raw.absence == null ? undefined : recognizedAbsence(raw.absence);
  const refused = raw.refused == null ? undefined : validateRefusal(fields, raw.refused);
  return {
    id: raw.id,
    question: raw.question,
    fields,
    ...(raw.supplied !== undefined && { supplied }),
    ...(context !== undefined && { context }),
    ...(absence !== undefined && { absence }),
    ...(refused !== undefined && { refused }),
  };
}

/** The app's refusal: its reason in its own words, and the refused answer judged like any answer. */
function validateRefusal(fields: readonly InputField[], raw: unknown): InputRefusal {
  if (
    !object(raw) ||
    !nonempty(raw.reason) ||
    Object.keys(raw).some((k) => !['answer', 'reason'].includes(k))
  )
    fail('refused must be { reason, answer? } with a non-blank reason in the app’s own words');
  return {
    ...(raw.answer != null && { answer: validateValues(fields, raw.answer) }),
    reason: raw.reason,
  };
}

/** A stored re-ask mark: a positive whole count, and a previous answer judged like any answer. */
function validateRepeat(fields: readonly InputField[], raw: unknown): InputRepeat {
  if (
    !object(raw) ||
    typeof raw.count !== 'number' ||
    !Number.isInteger(raw.count) ||
    raw.count < 1 ||
    Object.keys(raw).some((k) => !['count', 'previousAnswer'].includes(k))
  )
    fail('malformed repeat mark');
  return {
    count: raw.count,
    ...(raw.previousAnswer !== undefined && {
      previousAnswer: validateValues(fields, raw.previousAnswer),
    }),
  };
}

/** Where the same ask was last answered in this turn — what the runtime knows at a re-ask. */
export interface AnsweredAsk {
  /** The declaration `id` that was answered. */
  readonly id: string;
  /** The answered request's runtime token — how its landed result is found in the record. */
  readonly requestId: string;
  /** How many times this ask has been answered in this turn, this answer included. */
  readonly count: number;
}

/**
 * The re-ask mark for a declaration, or `undefined` when this is not a re-ask.
 * The previous answer is READ FROM THE RECORD — the
 * `input_received` result that landed for `answered.requestId`, after the
 * tool-result rules ran on it — so it is redacted exactly as the answer is.
 * Only the fields the PERSON supplied (origin `'response'`) are kept; when
 * the record holds no such result, or its values no longer satisfy the
 * fields, the mark carries the count alone.
 */
export function repeatOf(
  declaration: InputRequestDeclaration,
  answered: AnsweredAsk | undefined,
  history: readonly { readonly role: string; readonly content: unknown }[],
): InputRepeat | undefined {
  if (answered === undefined || answered.id !== declaration.id) return undefined;
  const previousAnswer = landedAnswer(declaration.fields, answered.requestId, history);
  return { count: answered.count, ...(previousAnswer !== undefined && { previousAnswer }) };
}

function landedAnswer(
  fields: readonly InputField[],
  requestId: string,
  history: readonly { readonly role: string; readonly content: unknown }[],
): Record<string, InputValue> | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]!;
    if (message.role !== 'tool' || typeof message.content !== 'string') continue;
    let landed: unknown;
    try {
      landed = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!object(landed) || landed.status !== 'input_received' || landed.requestId !== requestId)
      continue;
    if (!object(landed.values)) return undefined;
    const origins = object(landed.origins) ? landed.origins : undefined;
    const given = Object.fromEntries(
      Object.entries(landed.values).filter(([k]) => !origins || origins[k] === 'response'),
    );
    if (Object.keys(given).length === 0) return undefined;
    try {
      return validateValues(fields, given);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The declaration's `absence`, as the ONE recognizer reads it
 * (`agent/coverage/absent.ts` · `readAbsence`) — refused, never repaired,
 * when it reads nothing, so a raise cannot carry a miss the dispatch door
 * would then drop without a word. Held as handed over: it is read once, at
 * the raise, and the rows filed from it are copies
 * (`agent/stages/toolCalls.ts` · `declareCoverage` copies item by item).
 * An envelope it reads whose lists that copy cannot read (a hand-built
 * `checked: [null]`) is not refused here: the door meets it at the raise
 * and errors the call, as it would the same value returned
 * (`agent/stages/toolCalls.ts` · `declareRaisedAbsence`).
 */
function recognizedAbsence(raw: unknown): ToolAbsence {
  const absence = readAbsence(raw);
  if (absence === undefined) {
    fail(
      'absence must be the envelope absent() returns — absent({ what, checked }) — ' +
        'so the one recognizer can read what the tool looked at',
    );
  }
  return absence;
}

/** Runtime-only stamping: a model cannot choose its saved skill or original request. */
export function stampInputRequest(
  declaration: InputRequestDeclaration,
  requestId: string,
  origin: AwaitingInput['origin'],
  repeat?: InputRepeat,
): AwaitingInput {
  // The `absence` is filed at the raise and read by nothing after it — it
  // never rides the awaiting-input shape the person, the model and the
  // durable pause read (`readAwaitingInput` re-validates five keys, not six).
  const { absence: _filedAtTheRaise, ...clean } = validateInputDeclaration(declaration);
  void _filedAtTheRaise;
  const supplied = { ...clean.supplied };
  return {
    ...clean,
    status: 'awaiting_input',
    requestId,
    supplied,
    origins: Object.fromEntries(Object.keys(supplied).map((k) => [k, 'declaration' as const])),
    missing: clean.fields
      .filter((f) => f.required !== false && !own(supplied, f.id))
      .map((f) => f.id),
    ...(repeat !== undefined && { repeat: validateRepeat(clean.fields, repeat) }),
    origin: JSON.parse(JSON.stringify(origin)) as AwaitingInput['origin'],
  };
}

/** Read only an explicitly declared, well-shaped input pause; never assistant prose. */
export function readAwaitingInput(pauseData: unknown): AwaitingInput | undefined {
  if (!object(pauseData) || !own(pauseData, 'awaitingInput')) return undefined;
  const value = pauseData.awaitingInput;
  if (
    !object(value) ||
    value.status !== 'awaiting_input' ||
    !nonempty(value.requestId) ||
    !object(value.origin) ||
    typeof value.origin.originalRequest !== 'string' ||
    !nonempty(value.origin.toolCallId)
  )
    fail('malformed stored input request');
  const clean = validateInputDeclaration({
    id: value.id,
    question: value.question,
    fields: value.fields,
    supplied: value.supplied,
    ...(value.context !== undefined && { context: value.context }),
    ...(value.refused !== undefined && { refused: value.refused }),
  });
  if (value.repeat !== undefined) validateRepeat(clean.fields, value.repeat);
  const origins = value.origins;
  if (
    !object(origins) ||
    Object.keys(clean.supplied ?? {}).some(
      (k) => !['declaration', 'response'].includes(String(origins[k])),
    )
  )
    fail('malformed input origins');
  return JSON.parse(JSON.stringify({ ...value, ...clean })) as AwaitingInput;
}

/**
 * What the resume door knows when it checks a time field's answer: the
 * person's zone (the run clock's, under `.time()` — it arms the DST-gap check)
 * and the app's catalog overrides (`.time({ messages })`).
 */
export interface TimeAnswerContext {
  readonly zone?: ZoneName;
  readonly messages?: Partial<TimeAskMessages>;
}

/**
 * The time fields' answers the check refuses, field id → why — in field
 * order. Only a field with a `format` is judged: only a check the app armed
 * can refuse (time design § 6.2, TQ7).
 */
function refusedTimeAnswers(
  fields: readonly InputField[],
  values: Readonly<Record<string, InputValue>>,
  zone: ZoneName | undefined,
): [string, TimeAnswerRefusal][] {
  const refused: [string, TimeAnswerRefusal][] = [];
  for (const field of fields) {
    if (field.format === undefined || !own(values, field.id)) continue;
    const refusal = checkTimeAnswer(field.format, values[field.id] as string, zone);
    if (refusal !== undefined) refused.push([field.id, refusal]);
  }
  return refused;
}

/**
 * The same ask, asked again: the refused time answers are not taken (the
 * fields are `missing` again, whether or not they are required — the person
 * tried to answer them), the rest of the reply is kept, and the re-ask
 * carries the 9.127.0 shapes — `refused: { answer, reason }` with the
 * catalog's reason, and the runtime's `repeat: { count }` (the refused
 * answer never reached the record, so there is no `previousAnswer`).
 */
function reaskRefused(
  waiting: AwaitingInput,
  values: Readonly<Record<string, InputValue>>,
  refused: readonly [string, TimeAnswerRefusal][],
  time: TimeAnswerContext | undefined,
): AwaitingInput {
  const ids = new Set(refused.map(([id]) => id));
  const accepted = Object.fromEntries(Object.entries(values).filter(([k]) => !ids.has(k)));
  const drop = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([k]) => !ids.has(k)));
  const supplied = { ...drop(waiting.supplied), ...accepted };
  const messages: TimeAskMessages = { ...defaultTimeAskMessages, ...time?.messages };
  return {
    ...waiting,
    supplied,
    origins: {
      ...drop(waiting.origins),
      ...Object.fromEntries(Object.keys(accepted).map((k) => [k, 'response' as const])),
    },
    missing: waiting.fields
      .filter((f) => ids.has(f.id) || (f.required !== false && !own(supplied, f.id)))
      .map((f) => f.id),
    refused: {
      answer: Object.fromEntries(refused.map(([id]) => [id, values[id] as InputValue])),
      reason: refusalReason(
        refused.map(([, refusal]) => refusal),
        messages,
      ),
    },
    repeat: { count: (waiting.repeat?.count ?? 0) + 1 },
  };
}

/**
 * The refusal an ACCEPTED reply leaves standing. A refusal names the answer
 * it turned down (`InputRefusal.answer`); once the person has answered every
 * one of those fields again — and this reply was accepted — the refusal is
 * about an answer that no longer stands, so it is dropped: a UI must not say
 * "your answer was not accepted" beside a field it just took. A refusal that
 * names no answer, or one this reply did not answer again in full, stays.
 */
function refusalStillStanding(
  refusal: InputRefusal | undefined,
  values: Readonly<Record<string, InputValue>>,
): InputRefusal | undefined {
  if (refusal?.answer === undefined) return refusal;
  const named = Object.keys(refusal.answer);
  return named.length > 0 && named.every((id) => own(values, id)) ? undefined : refusal;
}

/**
 * Accept typed fields, or explicit cancellation, without coercing free text.
 * A time field's answer (`InputField.format`) is checked here too; one the
 * check refuses comes back as the same ask with `refused` and `repeat`, its
 * field `missing` again — the door that keeps a partial answer asks again
 * without running anything.
 */
export function applyInputResponse(
  waiting: AwaitingInput,
  raw: unknown,
  time?: TimeAnswerContext,
): AwaitingInput | InputCancellation {
  if (!object(raw) || raw.requestId !== waiting.requestId)
    fail('response names a different input request');
  if (raw.cancel === true) {
    if (Object.keys(raw).some((k) => !['requestId', 'cancel'].includes(k)))
      fail('cancellation cannot carry values');
    return { requestId: waiting.requestId, cancel: true };
  }
  if (Object.keys(raw).some((k) => !['requestId', 'values'].includes(k)))
    fail('unknown response field');
  const values = validateValues(waiting.fields, raw.values);
  if (Object.keys(values).length === 0) fail('supply at least one field or cancel explicitly');
  const refused = refusedTimeAnswers(waiting.fields, values, time?.zone);
  if (refused.length > 0) return reaskRefused(waiting, values, refused, time);
  const supplied = { ...waiting.supplied, ...values };
  const { refused: previous, ...kept } = waiting;
  const standing = refusalStillStanding(previous, values);
  return {
    ...kept,
    ...(standing !== undefined && { refused: standing }),
    supplied,
    origins: {
      ...waiting.origins,
      ...Object.fromEntries(Object.keys(values).map((k) => [k, 'response' as const])),
    },
    missing: waiting.fields
      .filter((f) => f.required !== false && !own(supplied, f.id))
      .map((f) => f.id),
  };
}
