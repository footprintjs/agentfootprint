/**
 * Annotates a pipeline spec tree with semantic icon hints for visualization.
 * Icons are matched by stage ID — unknown IDs are left without an icon.
 * Mutates the spec in-place and returns it for chaining.
 */

/** Well-known stage ID → icon mapping for agent concepts. */
const ICON_MAP: Record<string, string> = {
  // API slot stages
  'system-prompt': 'start',
  'messages': 'memory',
  'seed': 'start',

  // Call stages
  'call-llm': 'llm',
  'parse': 'parse',
  'parse-response': 'parse',
  'finalize': 'end',
  'handle-response': 'tool',

  // Agent loop stages
  'assemble-prompt': 'process',
  'apply-prepared-messages': 'memory',
  'commit-memory': 'memory',

  // RAG-specific
  'retrieve': 'rag',
  'augment-prompt': 'process',
};

export interface SpecLike {
  id?: string;
  icon?: string;
  next?: SpecLike;
  children?: SpecLike[];
  subflowStructure?: SpecLike;
}

export function annotateSpecIcons<T extends SpecLike>(
  spec: T,
  extraIcons?: Record<string, string>,
): T {
  const icons = extraIcons ? { ...ICON_MAP, ...extraIcons } : ICON_MAP;
  walkSpec(spec, icons);
  return spec;
}

function walkSpec(node: SpecLike, icons: Record<string, string>): void {
  if (node.id && icons[node.id] && !node.icon) {
    node.icon = icons[node.id];
  }
  if (node.children) {
    for (const child of node.children) walkSpec(child, icons);
  }
  if (node.next) walkSpec(node.next, icons);
  if (node.subflowStructure) walkSpec(node.subflowStructure, icons);
}
