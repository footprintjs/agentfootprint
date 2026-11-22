/** Bounded diagnostics for Ollama's HTTP error bodies and stream error frames. */
/**
 * `{"error": "..."}` — the uniform native error body. The object spelling
 * (`{"error": {"message": "..."}}`) is tolerated in case a proxy in the
 * middle reshaped it.
 */
interface OllamaErrorBody {
  error?: string | { message?: string };
}

/** Cap for any text the wire supplies before it becomes one of our messages. */
const ERROR_TEXT_CAP = 200;

/**
 * Native errors are `{"error": "..."}`; the object spelling and raw text are
 * tolerated. Every path is capped — the wire's words help diagnose, but a
 * daemon echoing something enormous (or poisoned) must not become the message.
 */
export function extractErrorText(bodyText: string): string {
  if (!bodyText) return '';
  try {
    const parsed = JSON.parse(bodyText) as OllamaErrorBody;
    const detail = extractErrorPayload(parsed.error);
    if (detail) return detail;
  } catch {
    /* not JSON — fall through */
  }
  return bodyText.slice(0, ERROR_TEXT_CAP);
}

/**
 * The words out of an `error` payload — a bare string on this wire, the
 * `{"message": "..."}` spelling tolerated — capped like every other piece of
 * wire text the adapter repeats. Empty when there is nothing usable to say, so
 * a caller can tell "no error" from "an error that named no reason".
 */
export function extractErrorPayload(err: unknown): string {
  if (typeof err === 'string') return err.slice(0, ERROR_TEXT_CAP);
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message.slice(0, ERROR_TEXT_CAP);
    }
  }
  return '';
}

/**
 * What a mid-stream frame says went wrong — '' when nothing did.
 *
 * One spelling on this wire: an NDJSON frame carrying `error`. It means the
 * generation failed, and it carries neither `message` nor `done`, which is
 * exactly why an unchecked one looks like an ordinary skippable frame. An
 * ordinary frame — the terminal `done` one included, whose content is empty
 * by design — has no `error` key at all, so this guard stays narrow.
 */
export function frameFailureText(frame: unknown): string {
  const data =
    typeof frame === 'object' && frame !== null ? (frame as { error?: unknown }) : undefined;
  const err = data?.error;
  if (err === undefined || err === null) return '';
  return extractErrorPayload(err) || 'the daemon reported an error but named no reason';
}
