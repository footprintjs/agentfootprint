// fallback.* (1)
export interface FallbackTriggeredPayload {
  readonly kind: 'provider' | 'tool' | 'skill';
  readonly primary: string;
  readonly fallback: string;
  readonly reason: string;
}
