import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { build } from 'esbuild';
import type { ComponentProps } from 'react';
import type { SkillGraphFlow } from '../../components/demos/skillGraphView';
import { buildSupportSkillGraph } from '../../components/demos/skillGraphDemo';
import { buildQuickstartSkillGraph } from '../../components/demos/skillGraphQuickstartDemo';
import { buildSkillGraphDemoData } from '../../components/SkillGraphTryItData';

describe('declared skill graph docs projection', () => {
  for (const [demo, builder] of [
    ['support', buildSupportSkillGraph],
    ['quickstart', buildQuickstartSkillGraph],
  ] as const) {
    it(`${demo}: draws and describes the real compiled graph using only plain data`, () => {
      const graph = builder();
      const data = buildSkillGraphDemoData(demo);
      assert.equal(data.demo, demo);
      assert.deepEqual(data.graph.nodes, graph.nodes);
      assert.deepEqual(data.graph.edges, graph.edges.map(({ from, to, kind, label }) => ({
        from, to, kind, ...(label !== undefined && { label }),
      })));
      assert.deepEqual(data.skills, graph.skills.map(skill => ({
        id: skill.id,
        ...(skill.description !== undefined && { description: skill.description }),
        ...(skill.inject.systemPrompt !== undefined && { body: skill.inject.systemPrompt }),
        tools: (skill.inject.tools ?? []).map(tool => tool.schema.name),
      })));
      // structuredClone catches leaked functions; JSON equality also catches
      // undefined, regexes, Maps and other values that are not plain view data.
      assert.deepEqual(structuredClone(data), data);
      assert.deepEqual(JSON.parse(JSON.stringify(data)), data);
      assert.deepEqual(Object.keys(data.graph).sort(), ['edges', 'nodes']);
    });
  }

  it('keeps the route/server wrapper above the client boundary and builders outside the client bundle', async () => {
    const docs = fileURLToPath(new URL('../..', import.meta.url));
    for (const path of [
      'app/docs/[[...slug]]/page.tsx', 'components/mdx.tsx', 'components/SkillGraphTryIt.tsx',
    ]) {
      assert.doesNotMatch(readFileSync(resolve(docs, path), 'utf8'), /^['"]use client['"]/);
    }
    const result = await build({
      entryPoints: [resolve(docs, 'components/SkillGraphTryItClient.tsx')],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
      external: ['react', 'react/jsx-runtime', 'agentfootprint-lens', '@xyflow/react/dist/style.css'],
      logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile!.inputs).join('\n');
    assert.match(inputs, /SkillGraphTryItInner\.tsx/);
    assert.doesNotMatch(inputs, /skillGraph(?:Quickstart)?Demo|SkillGraphTryItData|node_modules\/agentfootprint\//);
  });

  it('builds the public graph view while leaving its renderer dependencies with the site', async () => {
    const docs = fileURLToPath(new URL('../..', import.meta.url));
    const { bundleView } = createRequire(import.meta.url)('../skill-graph-view-loader.cjs') as {
      bundleView(entry: string): ReturnType<typeof build>;
    };
    // Next also type-checks this against the installed Lens public component.
    const props: ComponentProps<typeof SkillGraphFlow> = { graph: buildSkillGraphDemoData('support').graph };
    assert.ok(props.graph.nodes.length > 0);

    const result = await bundleView(resolve(docs, 'components/demos/skillGraphView.ts'));
    assert.ok(result.metafile);
    assert.equal(result.outputFiles?.length, 1);
    const outputs = Object.values(result.metafile.outputs);
    assert.equal(outputs.length, 1);
    assert.deepEqual(outputs[0].exports, ['SkillGraphFlow']);
    const imports = outputs[0].imports;
    assert.ok(imports.every(item => item.external && !item.path.startsWith('.') && !isAbsolute(item.path)));
    const dependencies = new Set(imports.map(item => item.path));
    assert.ok(dependencies.has('react'));
    assert.ok(dependencies.has('@xyflow/react'));
    assert.ok(!dependencies.has('agentfootprint-lens'));
    assert.doesNotMatch(Object.keys(result.metafile.inputs).join('\n'), /skillGraph(?:Quickstart)?Demo|SkillGraphTryItData/);
  });
});
