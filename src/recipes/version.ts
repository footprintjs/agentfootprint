/**
 * version — is this string a version, or something that looks like one?
 *
 * Pattern: a total predicate + a refusal sentence. Pure, no dependencies.
 * Role:    recipes/ layer. Used by `defineAgentRecipe` and by the same
 *          validation `AgentBuilder.recipe()` runs on a hand-written literal.
 * Emits:   N/A.
 *
 * ## Why strict SemVer, and why a near-miss is refused rather than repaired
 *
 * The version is the half of a recipe row that makes the other half worth
 * reading: two runs of `support-desk` that behaved differently are a mystery
 * until the record says `1.2.0` and `1.3.0`. That only works if every producer
 * spells versions the same way, so the ones that would quietly break grouping
 * are refused at the declaration:
 *
 *   `'1.2'`      two runs, `'1.2'` and `'1.2.0'`, that are the same version and
 *                do not group together.
 *   `'v1.2.3'`   the same, with a decoration that sorts differently.
 *   `'1.02.3'`   leading zeros: `'1.02.3'` and `'1.2.3'` again split one arm.
 *   `'latest'`   a RANGE, not a version — it names whatever was installed, so
 *   `'^1.2.3'`   the row would describe a different composition each week and
 *   `'1.x'`      say nothing about the run it is stamped on.
 *
 * None is repaired. Padding `'1.2'` to `'1.2.0'` would put a version on the
 * record that the author never wrote, which is the one thing a manifest field
 * may not do.
 */

/**
 * The official SemVer 2.0.0 grammar (semver.org, "Backus–Naur Form Grammar for
 * Valid SemVer Versions"), transcribed. Kept verbatim rather than loosened: a
 * home-grown `\d+\.\d+\.\d+` would accept `01.2.3` and reject `1.0.0-rc.1`,
 * which is wrong in both directions.
 */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Whether `value` is a SemVer 2.0.0 version string. Total: any input, no throw. */
export function isSemverVersion(value: unknown): value is string {
  return typeof value === 'string' && SEMVER.test(value);
}

/**
 * The sentence a bad version gets. Names the value, the grammar, and the
 * specific mistake when the shape identifies one — a refusal that only says
 * "invalid" makes the author guess which half was wrong.
 *
 * @param callSite - the API the author called, e.g. `defineAgentRecipe`.
 */
export function versionRefusal(callSite: string, value: unknown): string {
  const shown = typeof value === 'string' ? `'${value}'` : `${typeof value}`;
  return (
    `${callSite}: version ${shown} is not a version. A recipe's version must be SemVer 2.0.0 ` +
    `— three dot-separated numbers, optionally a prerelease and build ('1.2.0', '2.0.0-rc.1', ` +
    `'1.0.0+build.5').\n\n` +
    `${diagnose(value)}\n\n` +
    `Nothing is padded or stripped for you: the version is stamped on the run manifest, where ` +
    `it is the field two runs are grouped by, and a value the author never wrote would group ` +
    `runs that are not the same composition.`
  );
}

/** The specific mistake, when the shape names one. Falls back to the general rule. */
function diagnose(value: unknown): string {
  if (typeof value !== 'string') {
    return `A version is a string; this was ${value === null ? 'null' : typeof value}.`;
  }
  if (value.trim() === '') return 'This one is empty.';
  if (/^v/i.test(value)) {
    return `Drop the leading '${
      value[0] ?? 'v'
    }' — SemVer carries no prefix ('1.2.0', not '${value}').`;
  }
  if (/^\d+\.\d+$/.test(value)) {
    return (
      `This has two parts; SemVer has three. Did you mean '${value}.0'? Write it out — ` +
      `'${value}' and '${value}.0' would be two labels for one composition.`
    );
  }
  if (/^\d+$/.test(value)) {
    return `This is one number. Did you mean '${value}.0.0'?`;
  }
  if (/^[~^><=]/.test(value) || /\bx\b|\*/.test(value)) {
    return (
      `This is a RANGE, not a version. A range names whatever happens to be installed, so the ` +
      `manifest row would describe a different composition each week. Write the version this ` +
      `recipe IS.`
    );
  }
  if (/^0\d|\.0\d/.test(value)) {
    return `Numeric parts carry no leading zeros ('1.2.0', not '01.02.00').`;
  }
  return `Neither the numbers, the prerelease nor the build metadata matched the grammar.`;
}
