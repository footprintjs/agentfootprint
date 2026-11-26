/** Admit the stored declaration without evaluating its fields as application code. */
export function assertStoredReplyOrigin(message: unknown, location: string): void {
  if (!message || typeof message !== 'object' || !('replyOrigin' in message)) return;
  const invalid = () => new TypeError(`Invalid replyOrigin at ${location}`);
  const own = Object.getOwnPropertyDescriptor(message, 'replyOrigin');
  const role = Object.getOwnPropertyDescriptor(message, 'role');
  const content = Object.getOwnPropertyDescriptor(message, 'content');
  if (
    !own?.enumerable ||
    !('value' in own) ||
    role?.value !== 'assistant' ||
    typeof content?.value !== 'string'
  ) {
    throw invalid();
  }
  const mark: unknown = own.value;
  if (mark === null || typeof mark !== 'object') throw invalid();
  const prototype = Object.getPrototypeOf(mark);
  if (prototype !== null && prototype !== Object.prototype) throw invalid();
  const kind = Object.getOwnPropertyDescriptor(mark, 'kind');
  const id = Object.getOwnPropertyDescriptor(mark, 'runId');
  if (
    Reflect.ownKeys(mark).length !== 2 ||
    !kind?.enumerable ||
    !id?.enumerable ||
    (kind.value !== 'host' && kind.value !== 'model') ||
    typeof id.value !== 'string' ||
    !id.value.trim() ||
    id.value.length > 256
  )
    throw invalid();

  // The host writer emits just these three fields. A stored host entry
  // cannot smuggle provider replay or a tool call into the next request.
  if (
    kind.value === 'host' &&
    (Reflect.ownKeys(message).length !== 3 ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(message)))
  )
    throw invalid();
}
