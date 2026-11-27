import { isLibrarySkillReader } from '../../../injection-engine/skillTools.js';
import { skillVisibleToRole } from '../../../lib/spokenIds.js';
import type { LLMToolSchema } from '../../../provider-contract/types.js';
import { typeNameOf, type ToolArgIssue } from '../../../tools/toolArgsValidation.js';
import type { Tool } from '../../../tools/tools.js';
import type { SkillRoleView } from './toolVisibility.js';

function skillIds(schema: LLMToolSchema): readonly unknown[] {
  const properties = schema.inputSchema.properties as { readonly id?: { readonly enum?: unknown } };
  const values = properties?.id?.enum;
  return Array.isArray(values) ? values : [];
}

/** A hidden selection has a positive role witness. An unknown selection has none. */
export function isHiddenSkillRead(
  tool: Tool,
  args: Readonly<Record<string, unknown>>,
  role: SkillRoleView,
): boolean {
  return (
    isLibrarySkillReader(tool) &&
    Object.hasOwn(args, 'id') &&
    typeof args.id === 'string' &&
    role.hiddenSkillIds !== undefined &&
    !skillVisibleToRole(args.id, role.hiddenSkillIds)
  );
}

/** Check a library skill read against its role view before ordinary schema validation. */
export function skillReadArgumentIssue(
  tool: Tool,
  args: unknown,
  role: SkillRoleView | undefined,
  offered?: readonly LLMToolSchema[],
): ToolArgIssue | undefined {
  if (role === undefined || !isLibrarySkillReader(tool)) return undefined;
  const id =
    args !== null && typeof args === 'object' && Object.hasOwn(args, 'id')
      ? (args as { id: unknown }).id
      : undefined;
  const wire =
    offered === undefined
      ? tool.schema
      : offered.find((schema) => schema.name === tool.schema.name);
  if (
    typeof id === 'string' &&
    skillVisibleToRole(id, role.hiddenSkillIds) &&
    wire !== undefined &&
    skillIds(wire).includes(id) &&
    skillIds(tool.schema).includes(id)
  )
    return undefined;
  return { path: 'id', expected: 'an offered skill id', got: typeNameOf(id) };
}
