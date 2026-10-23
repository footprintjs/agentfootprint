/**
 * The request a paused consent gate put to a person — `checkIn` for a tool's
 * check-in, `ask` for a middleware's ask — read off a pause outcome or a hosted
 * `PendingAsk` (both carry the same two fields). It is what a test hands
 * `checkInApproved({ request, by })`, so the decision names the request it
 * answers. Throws when the pause is not a consent gate: a test that reaches for
 * a request on any other pause has the wrong pause.
 */
export function pausedRequest(paused: unknown): { readonly id: string } {
  const outcome = paused as
    | { readonly checkIn?: { readonly id?: unknown }; readonly ask?: { readonly id?: unknown } }
    | null
    | undefined;
  const request = outcome?.checkIn ?? outcome?.ask;
  if (request === undefined || typeof request.id !== 'string') {
    throw new Error('expected a consent-gate pause (a check-in or a middleware ask)');
  }
  return request as { readonly id: string };
}
