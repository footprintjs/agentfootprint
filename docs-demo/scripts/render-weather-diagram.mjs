import { palettes, renderGraphvizDiagram } from './render-graphviz-diagram.mjs';


function reachableNodes(graph) {
  // A structure recorder also sees the independently built templates for
  // mounted subflows. Follow the actual chart from its entry to draw each
  // mounted instance in its own scope, without the loose template copies.
  const visible = new Set(['seed']);
  for (const id of visible) {
    for (const node of graph.nodes) {
      if (node.data.subflowOf === id) visible.add(node.id);
    }
    for (const edge of graph.edges) {
      if (edge.source === id) visible.add(edge.target);
    }
  }
  return graph.nodes.filter(({ id }) => visible.has(id));
}

export function renderWeatherDiagram(graph, provenance, theme) {
  const colors = palettes[theme];
  const nodes = reachableNodes(graph);
  const dotIds = new Map(nodes.map(({ id }, index) => [id, `n${index}`]));
  const expanded = new Set(nodes.map(({ data }) => data.subflowOf).filter(Boolean));

  function draw(node) {
    const id = dotIds.get(node.id);
    const label = JSON.stringify(node.data.label);
    if (!expanded.has(node.id)) {
      return `${id} [label=${label}${node.data.isDecider ? ', shape=diamond' : ''}];`;
    }

    const children = nodes.filter(({ data }) => data.subflowOf === node.id);
    return `subgraph cluster_${id} {
      label=${label}; color="${colors.line}"; fillcolor="${colors.group}"; style="rounded,filled";
      ${id} [label="", shape=point, width=0, height=0, style=invis];
      ${children.map(draw).join('\n')}
      ${id} -> ${dotIds.get(children[0].id)} [style=invis];
    }`;
  }

  const edges = graph.edges
    .filter(({ source, target }) => dotIds.has(source) && dotIds.has(target))
    .map(({ source, target, data }) => {
      const from = dotIds.get(source);
      const to = dotIds.get(target);
      const attributes = [];
      if (expanded.has(source)) attributes.push(`ltail=cluster_${from}`);
      if (expanded.has(target)) attributes.push(`lhead=cluster_${to}`);
      if (data.kind === 'loop') {
        attributes.push(`constraint=false, style=dashed, color="${colors.loop}"`);
      }
      return `${from} -> ${to} [${attributes.join(', ')}];`;
    });

  const dot = `digraph QuickStart {
    graph [compound=true, bgcolor="${colors.background}", fontcolor="${colors.ink}",
      fontname="Helvetica", fontsize=13, pad=0.18, ranksep=0.28, nodesep=0.20];
    node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=12,
      fillcolor="${colors.node}", color="${colors.line}", fontcolor="${
    colors.ink
  }", margin="0.12,0.07"];
    edge [color="${colors.line}", arrowsize=0.66];
    ${nodes
      .filter(({ data }) => !data.subflowOf)
      .map(draw)
      .join('\n')}
    ${edges.join('\n')}
  }`;
  return renderGraphvizDiagram(dot, provenance);
}
