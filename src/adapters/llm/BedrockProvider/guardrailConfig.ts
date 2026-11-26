/** Explicit guardrail request configuration, validated before constructing an SDK client. */
import type { ProviderIntervention } from '../../../provider-contract/intervention.js';

/** Bedrock's documented tracing vocabulary; processing never publishes the raw trace. */
export type BedrockGuardrailTrace = 'disabled' | 'enabled' | 'enabled_full';

/** Guardrail applied to both Converse doors; streaming always uses synchronous screening. */
export interface BedrockGuardrailOptions {
  readonly id: string;
  readonly version: string;
  /** Defaults to disabled. An intervention without usable trace evidence remains unknown. */
  readonly trace?: BedrockGuardrailTrace;
  /** Maximum held text/tool UTF-8 bytes; exact fit is accepted. Default 1,048,576. */
  readonly maxBufferedBytes?: number;
  /** Format only a terminal refusal. Receives detached safe data, never raw provider trace. */
  readonly cleanMessage?: (intervention: Readonly<ProviderIntervention>) => string;
}

export interface GuardrailConfiguration {
  readonly id: string;
  readonly version: string;
  readonly trace: BedrockGuardrailTrace;
  readonly maxBufferedBytes: number;
  readonly cleanMessage?: BedrockGuardrailOptions['cleanMessage'];
}

const CONFIG_KEYS = new Set(['id', 'version', 'trace', 'maxBufferedBytes', 'cleanMessage']);
const IDENTIFIER =
  /^(?:[a-z0-9]+|arn:aws(?:-[^:]+)?:bedrock:[a-z0-9-]{1,20}:[0-9]{12}:guardrail\/[a-z0-9]+)$/;
const VERSION = /^(?:[1-9][0-9]{0,7}|DRAFT)$/;

function invalid(): never {
  throw new TypeError(
    'Bedrock guardrail configuration is invalid. Check id, version, trace, maxBufferedBytes and cleanMessage.',
  );
}

/** Read only own data fields: a configuration accessor is not executed to validate it. */
function field(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return invalid();
  }
  if (descriptor === undefined) return undefined;
  return 'value' in descriptor ? descriptor.value : invalid();
}

export function guardrailConfiguration(options: object): GuardrailConfiguration | undefined {
  const raw = field(options, 'guardrail');
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return invalid();
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(raw);
  } catch {
    return invalid();
  }
  if (
    keys.length > CONFIG_KEYS.size ||
    keys.some((key) => typeof key !== 'string' || !CONFIG_KEYS.has(key))
  )
    return invalid();
  const id = field(raw, 'id');
  const version = field(raw, 'version');
  const declaredTrace = field(raw, 'trace');
  const trace = declaredTrace === undefined ? 'disabled' : declaredTrace;
  const declaredMaximum = field(raw, 'maxBufferedBytes');
  const maxBufferedBytes = declaredMaximum === undefined ? 1_048_576 : declaredMaximum;
  const cleanMessage = field(raw, 'cleanMessage');
  if (typeof id !== 'string' || id.length > 2048 || !IDENTIFIER.test(id)) return invalid();
  if (typeof version !== 'string' || !VERSION.test(version)) return invalid();
  if (trace !== 'disabled' && trace !== 'enabled' && trace !== 'enabled_full') return invalid();
  if (
    typeof maxBufferedBytes !== 'number' ||
    !Number.isSafeInteger(maxBufferedBytes) ||
    maxBufferedBytes < 1
  )
    return invalid();
  if (cleanMessage !== undefined && typeof cleanMessage !== 'function') return invalid();
  return Object.freeze({
    id,
    version,
    trace,
    maxBufferedBytes,
    ...(cleanMessage === undefined
      ? {}
      : { cleanMessage: cleanMessage as BedrockGuardrailOptions['cleanMessage'] }),
  });
}

/** Both operation inputs use the same owned mapping; stream adds only its documented mode. */
export function guardrailWire(config: GuardrailConfiguration, streaming: boolean) {
  return {
    guardrailIdentifier: config.id,
    guardrailVersion: config.version,
    trace: config.trace,
    ...(streaming ? { streamProcessingMode: 'sync' as const } : {}),
  };
}
