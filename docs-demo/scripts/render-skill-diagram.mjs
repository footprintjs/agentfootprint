import { palettes, renderGraphvizDiagram } from './render-graphviz-diagram.mjs';

function matchLabel(match) {
  if (match?.kind === 'regex') return `/${match.source}/${match.flags}`;
  if (match?.kind === 'keywords') return match.keywords.join(', ');
}

export function renderSkillDiagram(graph, compiledEdges, provenance, theme) {
  const colors = palettes[theme];
  const ids = new Map(graph.nodes.map(({ id }, index) => [id, `n${index}`]));
  const nodes = graph.nodes.map(({ id, kind, label }) =>
    `${ids.get(id)} [label=${JSON.stringify(label ?? id)}${kind === 'predicate' ? ', shape=diamond' : ''}];`,
  );
  const edges = graph.edges.map(({ from, to, kind, label }, index) => {
    // Matchers are available on the compiled entry edges, which the run verified against this map.
    const caption = label ?? matchLabel(compiledEdges[index].match) ?? '';
    const style = kind === 'model' ? 'dashed' : 'solid';
    return `${from === null ? 'start' : ids.get(from)} -> ${ids.get(to)} [label=${JSON.stringify(caption)}, style=${style}];`;
  });
  return renderGraphvizDiagram(`digraph Skills {
    graph [bgcolor="${colors.background}", pad=0.2, ranksep=0.45, nodesep=0.45];
    node [shape=box, style="rounded,filled", fillcolor="${colors.node}", color="${colors.line}",
      fontcolor="${colors.ink}", fontname="Helvetica", fontsize=14, margin="0.2,0.09"];
    edge [color="${colors.line}", fontcolor="${colors.ink}", fontname="Helvetica", fontsize=12];
    start [label="START", shape=oval, fillcolor="${colors.group}"];
    ${nodes.join('\n')}
    ${edges.join('\n')}
  }`, provenance);
}
