/**
 * The COLUMN-TYPE CONTRACT's vocabulary — what a tool may say about the
 * columns of the rowset it returns, and the one rule that judges the saying.
 *
 * Pattern: closed vocabulary + definition-time assert (the `resultCeiling` /
 *          `resultClass` law: a declaration this library cannot honour fails
 *          at `defineTool`, never at the first row of the first run).
 * Role:    leaf. `src/integrity/` imports nothing outside itself, so the
 *          vocabulary lives HERE and `core/tools.ts` reaches in for it —
 *          never the other way round.
 *
 * ── Why the words are these words ───────────────────────────────────────
 * They are NOT invented. `number | string | boolean | date` is the vocabulary
 * this ecosystem's rowset consumers already speak — a column-type union with
 * exactly these members is what the visualization layer sniffs its way to
 * today. Declaring in the consumer's own words is the `resultKind` law
 * (9.70.0) restated one level down: the tool's result in the CONSUMER's
 * vocabulary, not the framework's.
 *
 * The one member deliberately NOT carried over is `unknown`. A sniffer needs
 * that word — it is what "I looked at the values and could not tell" sounds
 * like. A DECLARATION has no use for it: an author who does not know what a
 * column holds should not name the column, and `columns: { x: 'unknown' }`
 * would be a promise about nothing that the checker would then have to
 * pretend to verify.
 *
 * ── Two spellings, one meaning ──────────────────────────────────────────
 * A column maps to a bare type (`lun: 'number'`) or to an object form
 * (`note: { type: 'string', nullable: true }`). That is this library's house
 * pattern for exactly this shape — `CostBudget` takes a bare number or
 * `{ usd, onExceed }`, `artifacts` takes a bare store or `{ store, placement }`
 * — and it is normalized ONCE, here, so every reader downstream sees one
 * shape and no downstream file learns that there were two.
 */

/**
 * What a declared column holds.
 *
 * | word | what a value must be |
 * | --- | --- |
 * | `number` | a JavaScript number that is FINITE — `NaN` and the infinities are a number that means "no number", and a chart handed one draws nothing |
 * | `string` | a JavaScript string, including the empty one (emptiness is meaning, and meaning is above this check's ceiling) |
 * | `boolean` | `true` or `false` — never `'true'`, never `0`, never `1` |
 * | `date` | a valid `Date` instance, or a string `Date.parse` accepts (an epoch NUMBER is a `number`; say so and the axis picker stops guessing) |
 */
export type ColumnType = 'number' | 'string' | 'boolean' | 'date';

/** The closed set, in one place, for the assert and for its own error message. */
export const COLUMN_TYPES: readonly ColumnType[] = ['number', 'string', 'boolean', 'date'];

/** The object spelling of one column's declaration. */
export interface ColumnDeclaration {
  /** What the column holds. */
  readonly type: ColumnType;
  /**
   * `true` — a row of this column may legitimately carry NO VALUE (`null`,
   * `undefined`, or the key simply not set on that row), and such a row is
   * never a type violation.
   *
   * Default `false`, and the default is the strict one ON PURPOSE. The field
   * failure this check is built from was a value that went missing and left
   * an empty string behind; had the same code left a `null` behind, the
   * defect would have been identical and a lenient default would have waved
   * it through. One word turns it off, and every finding names that word — so
   * a legitimate null column costs a one-word edit, while a silent default
   * would cost the bug.
   *
   * `nullable` is a promise about VALUES. It is NOT a promise about the
   * column's existence: a declared column that appears in no row at all is a
   * `missing-column` finding whether or not it is nullable, because the
   * declaration named a column and the result has no such column. The valve
   * for "this column may or may not be there" is to not declare it —
   * unlisted columns are allowed and unjudged.
   */
  readonly nullable?: boolean;
}

/**
 * What a tool declares about the columns of its rowset — column name to type.
 *
 * OPEN, NEVER CLOSED. A declaration is a promise about what it NAMES, not a
 * schema of everything the result may contain: a column nobody listed is
 * allowed and is never judged. Two reasons, and both are the same reason.
 *
 *   • A closed schema punishes the wrong party. The day the backend adds a
 *     column, every one of these tools starts filing findings about a change
 *     that broke nothing — and a check that cries about correct behaviour is
 *     a check people switch off, which is how the failure it exists to catch
 *     gets back in.
 *   • It is the rule the neighbouring boundary already keeps.
 *     `toolArgsValidation` is permissive on keywords it does not know and
 *     enforces `additionalProperties: false` only when an author explicitly
 *     asks for it. Two validators at one seam disagreeing about whether
 *     silence means "allowed" would be a worse defect than either could
 *     catch.
 */
export type ToolResultColumns = Readonly<Record<string, ColumnType | ColumnDeclaration>>;

/** One column's declaration after normalization — the ONLY shape any reader
 *  downstream of `normalizeColumns` ever sees. */
export interface NormalizedColumn {
  readonly name: string;
  readonly type: ColumnType;
  readonly nullable: boolean;
}

/**
 * Both spellings into one list, in declaration order.
 *
 * Order is kept because it is the author's order, and a finding that names
 * columns in the order the author wrote them is a finding they can scan
 * against their own source.
 */
export function normalizeColumns(columns: ToolResultColumns): readonly NormalizedColumn[] {
  const out: NormalizedColumn[] = [];
  for (const [name, declared] of Object.entries(columns)) {
    if (typeof declared === 'string') {
      out.push({ name, type: declared, nullable: false });
      continue;
    }
    out.push({ name, type: declared.type, nullable: declared.nullable === true });
  }
  return out;
}

/**
 * Refuse a `resultColumns` this library cannot honour, at definition time —
 * naming the tool, the column and the fix.
 *
 * Exported beside {@link ColumnType} and called from `defineTool`, so a
 * misspelled type fails on the line that wrote it rather than at the first
 * rowset of the first armed run. Also called by the MCP ingest
 * (`readToolExtras`) on a bag from a server this process does not control —
 * which is why every read below goes through a fallback: a `null`, a number
 * or an array must reach the teaching refusal, never blow up on the way to
 * it.
 */
export function assertResultColumns(toolName: string, columns: unknown): void {
  if (columns === undefined) return;
  if (typeof columns !== 'object' || columns === null || Array.isArray(columns)) {
    throw new Error(
      `defineTool: tool '${toolName}' declares resultColumns ${JSON.stringify(columns)}, which ` +
        `is not a map of column name to type. Write it as ` +
        `{ logical_unit_number: 'number', host_group: 'string' } — or omit the field, which ` +
        `means this tool promises nothing about its columns and none are ever judged.`,
    );
  }
  const entries = Object.entries(columns as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error(
      `defineTool: tool '${toolName}' declares an EMPTY resultColumns. A declaration that names ` +
        `no column promises nothing, and omitting the field is how "nothing promised" is said ` +
        `— the two must not be different spellings of the same silence.`,
    );
  }
  for (const [name, declared] of entries) {
    if (name.trim().length === 0) {
      throw new Error(
        `defineTool: tool '${toolName}' declares a resultColumns entry with a blank column ` +
          `name. A column name is what a finding points at, and a blank one points nowhere.`,
      );
    }
    const type = typeof declared === 'string' ? declared : (declared as ColumnDeclaration)?.type;
    if (typeof declared === 'object' && declared !== null && !Array.isArray(declared)) {
      const nullable = (declared as ColumnDeclaration).nullable;
      if (nullable !== undefined && typeof nullable !== 'boolean') {
        throw new Error(
          `defineTool: tool '${toolName}' declares resultColumns['${name}'].nullable = ` +
            `${JSON.stringify(nullable)}, which is not a boolean. \`true\` says a row of this ` +
            `column may carry no value; omit it (or \`false\`) and a missing value is a ` +
            `violation like any other.`,
        );
      }
    }
    if (typeof type !== 'string' || !COLUMN_TYPES.includes(type as ColumnType)) {
      throw new Error(
        `defineTool: tool '${toolName}' declares column '${name}' as ${JSON.stringify(type)}, ` +
          `which is not a column type this library has. The types are: ` +
          `${COLUMN_TYPES.join(', ')} — a bare word ('number') or the object form ` +
          `({ type: 'number', nullable: true }). There is deliberately no 'unknown': a column ` +
          `whose type you do not know is a column to leave undeclared, and unlisted columns ` +
          `are allowed and never judged.`,
      );
    }
  }
}
