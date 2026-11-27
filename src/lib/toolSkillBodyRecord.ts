/** A library read_skill body tied to its landed call occurrence. */
export interface ToolSkillBodyRecord {
  readonly skillId: string;
  readonly digest: string;
  /** A surviving range of the original body in the delivered result. */
  readonly span?: { readonly start: number; readonly length: number };
}
