/** Typed missing-input values. Collection is distinct from permission or consent. */
export type InputValue = string | number | boolean;
export interface InputField {
  readonly id: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly required?: boolean;
  readonly description?: string;
  readonly enum?: readonly InputValue[];
}
export interface InputRequestDeclaration {
  readonly id: string;
  readonly question: string;
  readonly fields: readonly InputField[];
  /** Values the collection tool already knows; never labelled as a person's answer. */
  readonly supplied?: Readonly<Record<string, InputValue>>;
  /** Opaque JSON authored by the collecting tool, never editable by the reply. */
  readonly context?: Readonly<Record<string, unknown>>;
}
export interface AwaitingInput extends InputRequestDeclaration {
  readonly status: 'awaiting_input';
  /** Runtime-stamped token, distinct from the author's reusable declaration id. */
  readonly requestId: string;
  readonly supplied: Readonly<Record<string, InputValue>>;
  readonly origins: Readonly<Record<string, 'declaration' | 'response'>>;
  readonly missing: readonly string[];
  readonly origin: {
    readonly originalRequest: string;
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
function validateValues(fields: readonly InputField[], raw: unknown): Record<string, InputValue> {
  if (!object(raw)) fail('values must be an object');
  const values: Record<string, InputValue> = {};
  for (const [id, value] of Object.entries(raw)) {
    const field = fields.find((f) => f.id === id);
    if (!field) fail('values contain an undeclared field');
    if (
      typeof value !== field.type ||
      (typeof value === 'number' && !Number.isFinite(value)) ||
      (typeof value === 'string' && (value.length > 4096 || value.trim().length === 0)) ||
      (field.enum !== undefined && !field.enum.includes(value as InputValue))
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
    Object.keys(raw).some((k) => !['id', 'question', 'fields', 'supplied', 'context'].includes(k))
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
      Object.keys(field).some((k) => !['id', 'type', 'required', 'enum', 'description'].includes(k))
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
    return {
      id: copy.id,
      type: copy.type,
      ...(copy.required !== undefined && { required: copy.required }),
      ...(copy.description !== undefined && { description: copy.description }),
      ...(copy.enum !== undefined && { enum: [...copy.enum] }),
    };
  });
  const supplied = validateValues(fields, raw.supplied ?? {});
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
  return {
    id: raw.id,
    question: raw.question,
    fields,
    ...(raw.supplied !== undefined && { supplied }),
    ...(context !== undefined && { context }),
  };
}

/** Runtime-only stamping: a model cannot choose its saved skill or original request. */
export function stampInputRequest(
  declaration: InputRequestDeclaration,
  requestId: string,
  origin: AwaitingInput['origin'],
): AwaitingInput {
  const clean = validateInputDeclaration(declaration);
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
  });
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

/** Accept typed fields, or explicit cancellation, without coercing free text. */
export function applyInputResponse(
  waiting: AwaitingInput,
  raw: unknown,
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
  const supplied = { ...waiting.supplied, ...values };
  return {
    ...waiting,
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
