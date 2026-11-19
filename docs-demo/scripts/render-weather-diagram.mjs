import { Graphviz } from '@hpcc-js/wasm-graphviz';

const graphviz = await Graphviz.load();

const palettes = {
  light: {
    background: '#faf9f6',
    node: '#ffffff',
    group: '#f0ede5',
    line: '#777162',
    ink: '#27241d',
    loop: '#8c5918',
  },
  dark: {
    background: '#17171b',
    node: '#232328',
    group: '#1d1d23',
    line: '#8c8b94',
    ink: '#f1eee6',
    loop: '#eeb86c',
  },
};

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
  const svg = graphviz
    .dot(dot)
    .replace(/^[\s\S]*?(?=<svg )/, '')
    .replace(
      /(<svg [\s\S]*?>)/,
      `$1\n<metadata>AgentFootprint source commit ${
        provenance.commit
      }; published cohort ${provenance.cohort.join(', ')}</metadata>`,
    );
  // Graphviz emits integral pt dimensions and a matching viewBox.
  const [, width, height] = svg.match(/^<svg width="(\d+)pt" height="(\d+)pt"/);
  return { svg, width: Number(width), height: Number(height) };
}
