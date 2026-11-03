// validation.* (1)
/**
 * Emitted when LLM-produced tool args fail validation against the tool's
 * declared `inputSchema` (backlog #9). Fires for BOTH modes that validate:
 * `enforced: true` means the call was rejected before dispatch and the
 * model received a structured retry message as the tool result;
 * `enforced: false` ('warn' mode) means the tool executed anyway.
 * `issues` name paths, expectations, and received TYPES — never the
 * supplied values (they can carry PII / injection payloads).
 */
export interface ValidationArgsInvalidPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly issues: ReadonlyArray<{
    readonly path: string;
    readonly expected: string;
    readonly got: string;
    /**
     * A capped excerpt of the offending STRING — present on string-shape
     * issues (`pattern` / `minLength` / `maxLength`) only, where the
     * complaint IS the value's shape. Structural issues (type, enum,
     * required, additionalProperties) still carry no value at all.
     */
    readonly value?: string;
    /** The parameter's own schema `description`, when it declares one. */
    readonly hint?: string;
  }>;
  readonly enforced: boolean;
}
