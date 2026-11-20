import { Graphviz } from '@hpcc-js/wasm-graphviz';

const graphviz = await Graphviz.load();

export const palettes = {
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

export function renderGraphvizDiagram(dot, provenance) {
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
