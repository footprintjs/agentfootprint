import type { ArtifactStore } from '../../../../../artifacts/types.js';
import type { ArtifactPlacement } from '../../../../../artifacts/placement.js';

/** The artifacts dependencies of the existing tool-call stage. */
export interface ToolArtifactsPort {
  /**
   * The claim-check store (9.21.0). When present, every dispatch binds it to
   * the run's scope (`scope.runIdentity` — the tuple memory scopes on) as
   * `ctx.artifacts`, with `origin` stamped from the run's own facts and every
   * mint/resolve/sweep/refusal emitted as `agentfootprint.artifacts.*`.
   * Undefined — the default — and `ctx.artifacts` is the fail-closed teacher:
   * byte-identical behavior and events (zero-cost-when-unused).
   */
  readonly artifactStore?: ArtifactStore;
  /**
   * The placement threshold (9.22.0) — the operator's ref-ing dial. When set
   * (only ever beside `artifactStore`; the Agent option's shape enforces it),
   * every finalized tool result on every dispatch path is measured, and one
   * whose text exceeds `maxInlineChars` is checked into the store (under the
   * tool's declared `resultKind`, or `tool-result/<toolName>` when it
   * declares none) with the model reading the claim ticket
   * instead. Judged AFTER the tool's own `resultCeiling` and the after-tool
   * chain, BEFORE the `maxToolResultChars` truncation net. Undefined — the
   * default — and results are never measured against it (zero-cost).
   */
  readonly placement?: ArtifactPlacement;
}
