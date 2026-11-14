/** The recording-only frame at one logical model call, before provider I/O. */
export interface ContextRecordedPiece {
  readonly source: string;
  readonly sourceId?: string;
  /** Text exactly as assembled; absent for a schema. Governed before dispatch. */
  readonly rawContent?: string;
  /** The complete selected schema, not a name/description approximation. */
  readonly schema?: unknown;
}

/**
 * Opt-in content capture. Only an EXACT subscription requests this event;
 * wildcard sinks alone never enable it. Once requested, every ordinary sink
 * sees the same served event. Treat it as sensitive prompt material.
 *
 * This is a logical call's assembled context, not an adapter's serialized
 * request and not evidence that a provider accepted it. Conversation messages
 * remain on their existing recording channels. Request-only context is named
 * separately from the standing system pieces.
 */
export interface ContextRecordedPayload {
  readonly iteration?: number;
  /** Capture refused; the model call continues with its original inputs. */
  readonly omission?: 'not-json';
  readonly pieces: readonly ContextRecordedPiece[];
}
