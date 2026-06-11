/**
 * Structural lint rules (RFC-002 block C2) — the PLUGGABLE RULE PACK.
 *
 * Pattern: Strategy list — each rule is a plain `{ id, check }` object;
 *          `defaultStructuralRules` is OUR pack, and consumers add /
 *          remove / replace freely via `AnalyzeToolCatalogOptions.rules`.
 *          Parameterizable rules ship as FACTORIES (`descriptionRule`,
 *          `saysWhatNotWhenRule`, …) returning a configured `LintRule`.
 * Role:    `src/lib/tool-lint/` leaf. Pure functions over `CatalogTool`;
 *          no embedder, no I/O.
 *
 * Every rule encodes a FIELD FINDING from real catalogs (the Neo SAN
 * triage agent's 29-tool catalog was the seed corpus):
 *
 *   1. description-missing-or-short — the model can only guess from a name.
 *   2. says-what-not-when — describes WHAT the tool returns but gives the
 *      model no cue for WHEN to pick it over a sibling (the #1 cause of
 *      twin-tool confusion: 'get_fcns_database' vs 'influx_get_fcns_database').
 *   3. enum-in-prose — string params whose legal values are listed in prose
 *      ("avg_iops | peak_iops | mbps") instead of a JSON-Schema `enum` the
 *      model (and validators, see #9 tool-args validation) can act on.
 *   4. optional-param-undocumented — optional params whose omission has
 *      meaning (fabric-wide sweep vs one switch) but whose schema never
 *      says so; the model can't reason about leaving them out.
 *
 * Honest claim: these are token/regex HEURISTICS. They flag review
 * prompts, not certainties — expect (rare) false positives and tune via
 * the factory options instead of deleting the rule.
 */

import type { CatalogTool, LintRule, StructuralFinding } from './types.js';

// ── shared helpers ───────────────────────────────────────────────────

interface SchemaProperty {
  readonly type?: unknown;
  readonly description?: unknown;
  readonly enum?: unknown;
}

/** Read `properties` / `required` out of a JSON-Schema-ish inputSchema,
 *  tolerating absent or malformed shapes (rules must never throw). */
function readObjectSchema(tool: CatalogTool): {
  properties: ReadonlyArray<readonly [string, SchemaProperty]>;
  required: ReadonlySet<string>;
} {
  const schema = tool.inputSchema;
  const props = schema?.properties;
  const properties: Array<readonly [string, SchemaProperty]> =
    props !== null && typeof props === 'object'
      ? Object.entries(props as Record<string, unknown>).filter(
          (entry): entry is [string, SchemaProperty] =>
            entry[1] !== null && typeof entry[1] === 'object',
        )
      : [];
  const required = new Set<string>(
    Array.isArray(schema?.required) ? schema.required.filter((r) => typeof r === 'string') : [],
  );
  return { properties, required };
}

function hasWholeWord(text: string, word: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(word.toLowerCase())}(?:[^a-z0-9]|$)`).test(
    text.toLowerCase(),
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Rule 1 — description missing or too short ────────────────────────

export interface DescriptionRuleOptions {
  /** Descriptions shorter than this (in chars) get a `warn`. Default 40. */
  readonly minChars?: number;
}

/**
 * Missing description → `error` (the model can only guess from the
 * name). Present but shorter than `minChars` → `warn` (too short to
 * differentiate from siblings).
 */
export function descriptionRule(options: DescriptionRuleOptions = {}): LintRule {
  const minChars = options.minChars ?? 40;
  return {
    id: 'description-missing-or-short',
    check(tool): readonly StructuralFinding[] {
      const description = tool.description?.trim() ?? '';
      if (description.length === 0) {
        return [
          {
            rule: 'description-missing-or-short',
            tool: tool.name,
            severity: 'error',
            message: 'tool has no description — the model can only guess from the name',
          },
        ];
      }
      if (description.length < minChars) {
        return [
          {
            rule: 'description-missing-or-short',
            tool: tool.name,
            severity: 'warn',
            message: `description is ${description.length} chars (< ${minChars}) — too short to differentiate this tool from its siblings`,
          },
        ];
      }
      return [];
    },
  };
}

// ── Rule 2 — says WHAT, not WHEN ─────────────────────────────────────

/** RFC-002 C2 heuristic cue list — temporal/conditional words whose
 *  presence suggests the description says WHEN to use the tool. */
export const DEFAULT_WHEN_CUES: readonly string[] = [
  'for',
  'when',
  'after',
  'first',
  'fallback',
  'only',
];

export interface SaysWhatNotWhenRuleOptions {
  /** Cue tokens (whole-word, case-insensitive). Default `DEFAULT_WHEN_CUES`. */
  readonly cueTokens?: readonly string[];
}

/**
 * A description with NO temporal/conditional cue token usually describes
 * WHAT the tool returns but never WHEN to pick it — the #1 cause of
 * twin-tool confusion. Heuristic by design: tune `cueTokens` rather than
 * dropping the rule. Skips tools with no description (rule 1's finding).
 */
export function saysWhatNotWhenRule(options: SaysWhatNotWhenRuleOptions = {}): LintRule {
  const cues = options.cueTokens ?? DEFAULT_WHEN_CUES;
  return {
    id: 'says-what-not-when',
    check(tool): readonly StructuralFinding[] {
      const description = tool.description?.trim() ?? '';
      if (description.length === 0) return [];
      if (cues.some((cue) => hasWholeWord(description, cue))) return [];
      return [
        {
          rule: 'says-what-not-when',
          tool: tool.name,
          severity: 'warn',
          message:
            'description says WHAT the tool returns but gives no cue for WHEN to use it ' +
            `(no ${cues.map((c) => `'${c}'`).join('/')}) — add the choice condition, ` +
            'e.g. "Use when …" / "Call FIRST" / "FALLBACK if …"',
        },
      ];
    },
  };
}

// ── Rule 3 — enum described in prose ─────────────────────────────────

const IDENT = '[A-Za-z][A-Za-z0-9_.-]*';
/** `avg_iops | peak_iops | mbps` — two or more pipe-separated literals. */
const PIPE_LIST = new RegExp(`(${IDENT})(?:\\s*\\|\\s*(?:${IDENT}))+`);
/** `one of: red, green, blue` — comma lists only behind an explicit
 *  values marker, so free-form examples ("e.g. 1h, 24h") don't flag. */
const COMMA_LIST = new RegExp(
  `(?:one of|allowed values?|valid values?|options|values)\\s*:?\\s*(${IDENT}(?:\\s*,\\s*${IDENT})+)`,
  'i',
);

/**
 * A string param whose description enumerates its legal values in prose
 * (pipe-separated literals, or comma lists behind "one of"/"allowed
 * values") should declare a JSON-Schema `enum` instead — the model picks
 * reliably from enums, and arg validators (#9) can enforce them. The
 * field case: Neo's `influx_get_port_ranking.metric` =
 * `"avg_iops | peak_iops | mbps"`.
 */
export function enumInProseRule(): LintRule {
  return {
    id: 'enum-in-prose',
    check(tool): readonly StructuralFinding[] {
      const findings: StructuralFinding[] = [];
      const { properties } = readObjectSchema(tool);
      for (const [param, prop] of properties) {
        if (prop.enum !== undefined) continue;
        if (prop.type !== undefined && prop.type !== 'string') continue;
        const description = typeof prop.description === 'string' ? prop.description : '';
        if (description.length === 0) continue;
        const literals = extractProseLiterals(description);
        if (literals === undefined) continue;
        findings.push({
          rule: 'enum-in-prose',
          tool: tool.name,
          severity: 'warn',
          param,
          message: `param '${param}' lists its legal values in prose ("${description.slice(
            0,
            80,
          )}") — declare them as a JSON-Schema enum so the model picks reliably`,
          suggestion: `"enum": ${JSON.stringify(literals)}`,
        });
      }
      return findings;
    },
  };
}

function extractProseLiterals(description: string): readonly string[] | undefined {
  const pipe = PIPE_LIST.exec(description);
  if (pipe) {
    return pipe[0].split('|').map((v) => v.trim());
  }
  const comma = COMMA_LIST.exec(description);
  if (comma) {
    return comma[1].split(',').map((v) => v.trim());
  }
  return undefined;
}

// ── Rule 4 — optional param whose omission is undocumented ───────────

/** Words that signal the description DOES say what omission means. */
export const DEFAULT_OMISSION_CUES: readonly string[] = [
  'optional',
  'default',
  'defaults',
  'omit',
  'omitted',
  'if not',
  'when not',
  'absent',
  'all',
  'entire',
  'every',
  'fallback',
];

export interface OptionalParamRuleOptions {
  /** Cue tokens that satisfy the rule. Default `DEFAULT_OMISSION_CUES`. */
  readonly omissionCues?: readonly string[];
}

/**
 * An optional param's omission usually MEANS something (Neo:
 * `influx_get_interface_counters` without `switch_name` = fabric-wide
 * sweep) — but the model can only reason about leaving a param out if
 * the description says so. No description at all, or one with no
 * omission cue, gets a `warn`.
 */
export function optionalParamRule(options: OptionalParamRuleOptions = {}): LintRule {
  const cues = options.omissionCues ?? DEFAULT_OMISSION_CUES;
  return {
    id: 'optional-param-undocumented',
    check(tool): readonly StructuralFinding[] {
      const findings: StructuralFinding[] = [];
      const { properties, required } = readObjectSchema(tool);
      for (const [param, prop] of properties) {
        if (required.has(param)) continue;
        const description = typeof prop.description === 'string' ? prop.description.trim() : '';
        if (description.length === 0) {
          findings.push({
            rule: 'optional-param-undocumented',
            tool: tool.name,
            severity: 'warn',
            param,
            message: `optional param '${param}' has no description — say what happens when it is omitted (a default? a broader scope?)`,
          });
        } else if (!cues.some((cue) => hasWholeWord(description, cue))) {
          findings.push({
            rule: 'optional-param-undocumented',
            tool: tool.name,
            severity: 'warn',
            param,
            message: `optional param '${param}' is described but never says what omission means — add e.g. "optional — defaults to …" / "omit for all …"`,
          });
        }
      }
      return findings;
    },
  };
}

// ── The default pack ─────────────────────────────────────────────────

/**
 * OUR rule pack, built with default options. Compose your own:
 *
 *   rules: [...defaultStructuralRules, myRule]                 // add
 *   rules: defaultStructuralRules.filter(r => r.id !== '…')    // remove
 *   rules: [descriptionRule({ minChars: 80 }), …]              // re-tune
 */
export const defaultStructuralRules: readonly LintRule[] = [
  descriptionRule(),
  saysWhatNotWhenRule(),
  enumInProseRule(),
  optionalParamRule(),
];
