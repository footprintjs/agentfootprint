/** The branded replacement passed to a FootprintJS observer under summary capture. */
export interface DeferredPayloadSummary {
  readonly __payloadSummary: true;
}

export function isDeferredPayloadSummary(value: unknown): value is DeferredPayloadSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getOwnPropertyDescriptor(value, '__payloadSummary')?.value === true
  );
}
