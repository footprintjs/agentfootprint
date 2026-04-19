/**
 * SkillRegistry — a compiler from a set of `Skill`s into the three
 * existing primitives Agent already understands:
 *
 *   Skills  ──▶  AgentInstruction[]   (prompt + tools + onToolResult + activeWhen)
 *           ──▶  [list_skills, read_skill]  (auto-generated ToolDefinitions)
 *           ──▶  system-prompt fragment (when surface mode permits)
 *
 * Registry is in-process and immutable-after-build — panel #5 flagged
 * hot-swap as Phase 2. Registration is idempotent on `{id, version}`:
 * re-registering the same id+version is a no-op; re-registering the
 * same id with a different version replaces (with a dev warning).
 *
 * Events are emitted via the existing `$emit` channel; no new
 * observer system — panel #6.
 */
import type { AgentInstruction } from '../instructions';
import { defineTool } from '../../tools';
import { resolveSkillBody } from './renderBody';
import { resolveSurfaceMode } from './surfaceMode';
import type {
  GeneratedSkillTools,
  Skill,
  SkillListEntry,
  SkillRegistryOptions,
  SurfaceMode,
} from './types';

const DEFAULT_PROMPT_HEADER = 'Available skills — call `read_skill({ id })` to activate one:';

export class SkillRegistry<TDecision = unknown> {
  private readonly skills = new Map<string, Skill<TDecision>>();
  private readonly options: Required<Pick<SkillRegistryOptions, 'surfaceMode' | 'promptHeader'>> &
    Pick<SkillRegistryOptions, 'providerHint'>;

  constructor(options: SkillRegistryOptions = {}) {
    this.options = {
      surfaceMode: options.surfaceMode ?? 'tool-only',
      promptHeader: options.promptHeader ?? DEFAULT_PROMPT_HEADER,
      ...(options.providerHint && { providerHint: options.providerHint }),
    };
  }

  /**
   * Register a skill.
   *
   * Behavior on duplicate `id`:
   *   - Same `version`: silent no-op (idempotent — safe to call during
   *     module init multiple times).
   *   - Different `version`: REPLACES the existing entry AND fires a
   *     dev-mode `console.warn`. Evals almost certainly need pinning
   *     to one version at a time, so the warning nudges authors to
   *     make the replacement intentional.
   *
   * Registration order is preserved by `list()` / `toPromptFragment()`.
   *
   * TODO(phase-2): when `refreshPolicy.afterTokens` lands, the registry
   * must also expose a `hash` of its contents so the runtime can detect
   * "registry changed since last read_skill surface" and re-inject.
   */
  register(skill: Skill<TDecision>): this {
    const existing = this.skills.get(skill.id);
    if (existing) {
      if (existing.version === skill.version) {
        // Idempotent — same version, no-op.
        return this;
      }
      if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(
          `[agentfootprint] SkillRegistry: replacing skill '${skill.id}' v${existing.version} → v${skill.version}. Pin explicitly if this is not intentional.`,
        );
      }
    }
    this.skills.set(skill.id, skill);
    return this;
  }

  /** Register multiple skills. */
  registerAll(skills: readonly Skill<TDecision>[]): this {
    for (const s of skills) this.register(s);
    return this;
  }

  /** Look up a skill by id. Returns undefined when unknown. */
  getById(id: string): Skill<TDecision> | undefined {
    return this.skills.get(id);
  }

  /** All registered skills, in insertion order. */
  list(): readonly Skill<TDecision>[] {
    return Array.from(this.skills.values());
  }

  /**
   * Filter skills by scope tag and/or case-insensitive query over
   * `title + description`. Used by the auto-generated `list_skills`
   * tool — panel #3 (`scope` / `query` filtering in the signature
   * from day one).
   */
  search(options: { scope?: string; query?: string } = {}): readonly Skill<TDecision>[] {
    const { scope, query } = options;
    const q = query?.trim().toLowerCase();
    const out: Skill<TDecision>[] = [];
    for (const s of this.skills.values()) {
      if (scope && !(s.scope ?? []).includes(scope)) continue;
      if (q) {
        const haystack = `${s.title} ${s.description}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      out.push(s);
    }
    return out;
  }

  /**
   * Resolve the effective surface mode for this registry, consulting
   * the provider hint when `'auto'`. Stable — consumers can call this
   * once at build time.
   */
  effectiveSurfaceMode(): Exclude<SurfaceMode, 'auto'> {
    return resolveSurfaceMode(this.options.surfaceMode, this.options.providerHint);
  }

  /**
   * Compile skills into the `AgentInstruction[]` the Agent loop already
   * knows how to evaluate. Every Skill already extends AgentInstruction —
   * this is a type-narrowed passthrough.
   */
  toInstructions(): readonly AgentInstruction<TDecision>[] {
    return Array.from(this.skills.values());
  }

  /**
   * Generate the `list_skills` + `read_skill` tool pair. Both tools go
   * through `defineTool()` so they appear correctly in manifest /
   * narrative / toOpenAPI output (panel #6).
   */
  toTools(): GeneratedSkillTools {
    const registry = this;

    const listSkills = defineTool({
      id: 'list_skills',
      description:
        'List available skills. Returns {id, title, description, version} for each. Optional `scope` and `query` filters.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            description: 'Only return skills whose scope array includes this tag.',
          },
          query: {
            type: 'string',
            description: 'Case-insensitive search across title + description.',
          },
        },
      },
      handler: async (input: { scope?: string; query?: string }) => {
        const matches = registry.search({
          ...(input?.scope && { scope: input.scope }),
          ...(input?.query && { query: input.query }),
        });
        const entries: SkillListEntry[] = matches.map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          version: s.version,
          ...(s.scope && { scope: s.scope }),
        }));
        return { content: JSON.stringify({ skills: entries }, null, 2) };
      },
    });

    const readSkill = defineTool({
      id: 'read_skill',
      description:
        'Read a skill body by id. The returned text is the procedure to follow — treat it as active guidance for the current turn.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The skill id returned by list_skills.' },
        },
        required: ['id'],
      },
      handler: async (input: { id: string }) => {
        const id = input?.id;
        if (typeof id !== 'string' || id.length === 0) {
          return {
            content: 'Error: read_skill requires a non-empty `id` string.',
            isError: true,
          };
        }
        const skill = registry.getById(id);
        if (!skill) {
          // Panel #3 + #8: unknown id is a tool-result error the model
          // can recover from — NOT a thrown exception.
          return {
            content: `Error: skill '${id}' not found. Call list_skills to see available skills.`,
            isError: true,
          };
        }
        try {
          const body = await resolveSkillBody(skill);
          return { content: body };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: `Error loading skill '${id}': ${msg}`,
            isError: true,
          };
        }
      },
    });

    return { listSkills, readSkill };
  }

  /**
   * System-prompt fragment listing skills + their descriptions. Returns
   * `null` when the effective surface mode is `'tool-only'` (no prompt
   * injection) OR when the registry is empty (no ghost header).
   */
  toPromptFragment(): string | null {
    const mode = this.effectiveSurfaceMode();
    if (mode === 'tool-only') return null;
    if (this.skills.size === 0) return null;

    const lines = [this.options.promptHeader, ''];
    for (const s of this.skills.values()) {
      lines.push(`- ${s.id} — ${s.title}: ${s.description}`);
    }
    return lines.join('\n');
  }
}
