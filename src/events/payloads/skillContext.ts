/**
 * `llm_start.skillContext` — which way the agent's skills reach the model,
 * and why. Two "which strategy, and why" records in the shared decision-record
 * shape (`{ strategy, by, rule?, label?, reads, voucher? }`, footprintjs ·
 * `decisionRecord` / `fixedRecord`), plus the binding fact that decided them.
 */

/** One decision, in the shared decision-record shape. Names only, never a value. */
export interface SkillContextChoice<S extends string = string> {
  /** The branch chosen. */
  readonly strategy: S;
  /** `rule`: a rule of the table; `default`: the table's default; `fixed`: the app stated it. */
  readonly by: 'rule' | 'default' | 'fixed';
  /** The winning rule's index, counted from 0, when `by` is `rule`. */
  readonly rule?: number;
  /** The reason, in the table author's words. */
  readonly label?: string;
  /** The names of the facts that decided it. */
  readonly reads: readonly string[];
  /** Who stated a fixed choice. */
  readonly voucher?: 'app' | 'provider';
}

export interface SkillContextRecord {
  /** The tool strategy: `listed` (every skill tool from request 1) or `declared`. */
  readonly tools: SkillContextChoice<'listed' | 'declared'>;
  /** Where a body `read_skill` loads travels: `tool-result` or `declared`, and the measurement behind it. */
  readonly body: SkillContextChoice<'tool-result' | 'declared'> & {
    readonly measurement: { readonly script: string; readonly run: string };
  };
  /** The strictest binding answer over the providers the agent's calls reach, and who stated it. */
  readonly binding: {
    readonly binding: 'bound' | 'unknown' | 'unbound';
    readonly by: 'provider' | 'app';
    readonly provider: string;
    readonly model: string;
  };
}
