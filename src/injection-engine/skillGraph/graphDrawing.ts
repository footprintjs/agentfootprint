import type { SkillNode, SkillEdge } from './graphRoutes.js';
import { mermaidMatchCaption } from '../skillMatch.js';
import { mermaidGuardCaption } from '../skillGuard.js';

/** Mermaid node ids must be identifier-safe; keep the original id as the label. */
function nodeId(id: string): string {
  return 'n_' + id.replace(/[^A-Za-z0-9_]/g, '_');
}

export function renderMermaid(nodes: readonly SkillNode[], edges: readonly SkillEdge[]): string {
  const kindById = new Map(nodes.map((n) => [n.id, n.kind] as const));
  const ref = (id: string) => (kindById.get(id) === 'predicate' ? id : nodeId(id));
  const lines = ['flowchart TD', '  __start__([▶ start])'];
  for (const n of nodes) {
    lines.push(
      n.kind === 'predicate'
        ? `  ${n.id}{"${n.label ?? n.id}"}` // predicate → diamond
        : `  ${nodeId(n.id)}["${n.label ?? n.id}"]`, // skill → box
    );
  }
  for (const e of edges) {
    const from = e.from === null ? '__start__' : ref(e.from);
    const arrow = e.kind === 'model' ? '-.->' : '-->'; // model edges dashed
    // An explicit label wins unchanged; a data matcher captions its entry edge
    // and a data guard captions its guard-only route edge (that is half the
    // point of declaring the condition as data — it can be drawn). A guard
    // composed with a tool/status part is already folded into that derived
    // label at build.
    const caption =
      e.label ??
      (e.match ? mermaidMatchCaption(e.match) : e.guard ? mermaidGuardCaption(e.guard) : undefined);
    const label = caption ? `|${caption}|` : '';
    lines.push(`  ${from} ${arrow}${label} ${ref(e.to)}`);
  }
  return lines.join('\n');
}
