import type { TraversalContext } from 'footprintjs';

// `FlowRunEvent` isn't re-exported from footprintjs's main barrel in
// 4.16.0. Local structural copy matches the public shape exactly —
// `{ payload?: unknown; traversalContext?: TraversalContext }`.
// Add this to footprintjs/index re-exports next minor; remove this
// shim then.
interface FlowRunEvent {
  readonly payload?: unknown;
  readonly traversalContext?: TraversalContext;
}

// Structural shim for footprintjs's FlowRunFailedEvent (the terminal
// run-boundary event on a thrown run). Only `.message` is needed here.
interface FlowRunFailedEvent {
  readonly structuredError: { readonly message: string };
  readonly traversalContext?: TraversalContext;
}

export type { FlowRunEvent, FlowRunFailedEvent };
