export interface ClaimsPort {
  claimsContract?: Readonly<Record<string, { entity: string; field: string }>>;
}

export function configureClaims<TReceiver extends ClaimsPort>(
  self: TReceiver,
  contract: Readonly<Record<string, { entity: string; field: string }>>,
  original: object,
): object {
  if (self.claimsContract !== undefined) {
    throw new Error(
      `Agent.claims(): the claim contract is already declared. One contract per agent — a ` +
        `second call would silently replace the first. Merge the fields into one call.`,
    );
  }
  const entries = Object.entries(contract);
  if (entries.length === 0) {
    throw new Error(
      `Agent.claims(): the contract names no fields — omitting the call is how "this agent ` +
        `claims nothing checkable" is said.`,
    );
  }
  for (const [answerField, fact] of entries) {
    // An identity edge with a blank half joins the wrong subjects — the
    // same refusal `defineTool({ owner })` makes, for the same reason.
    if (
      fact === null ||
      typeof fact !== 'object' ||
      typeof fact.entity !== 'string' ||
      fact.entity.length === 0 ||
      typeof fact.field !== 'string' ||
      fact.field.length === 0
    ) {
      throw new Error(
        `Agent.claims(): '${answerField}' must name a non-empty entity and field — it is the ` +
          `edge the claim check joins on, and a blank half joins the wrong subjects. Got ` +
          `${JSON.stringify(fact)}.`,
      );
    }
  }
  self.claimsContract = contract;
  return original;
}
