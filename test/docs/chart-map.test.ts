import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { collectChartMap, renderChartMap } from '../../scripts/chart-map/index.mjs';

interface SourceRow {
  file: string;
  line: number;
  owner: string;
  method: string;
  id: string;
  context: string[];
  certainty: 'engine' | 'unresolved';
}
interface MountRow extends SourceRow {
  target: string;
  mountName: string;
}
interface StageRow extends SourceRow {
  name: string;
  description: { state: 'literal' | 'expression' | 'absent'; text: string };
}
interface Inventory {
  mounts: MountRow[];
  stages: StageRow[];
}

const repository = resolve(__dirname, '../..');
const source = `import { flowChart } from 'footprintjs';

throw new Error('A source collector must never evaluate this module.');
const stage = () => { throw new Error('Never execute a stage.'); };
const lazy = () => { throw new Error('Never resolve a lazy mount.'); };
const provider = { complete() { throw new Error('Never call a provider.'); } };
void provider;

export function buildFixture(description: string, dynamicId: string, enabled: boolean, fork: boolean) {
  const child = flowChart('Child', stage, 'child', { description: 'Child entry text.' }).build();
  let builder = flowChart('Start', stage, 'start', { description: 'Root entry text.' });
  if (enabled) {
    builder = builder.addSubFlowChartNext('repeat', child, 'Conditional child');
  }
  for (const name of ['one', 'two']) {
    builder = builder.addSubFlowChartNext('repeat', child, name);
  }
  const append = fork
    ? builder.addSubFlowChart.bind(builder)
    : builder.addSubFlowChartNext.bind(builder);
  builder = append('bound', child, 'Bound child');
  builder = builder.addLazySubFlowChartNext('lazy', lazy, 'Lazy child');
  builder
    .addFunction('Known text', stage, 'known', 'Literal description.')
    .addFunction('No text', stage, 'absent')
    .addFunction('Blank text', stage, 'blank', '  ')
    .addFunction('Computed text', stage, 'computed', description)
    .addFunction('Dynamic id', stage, dynamicId, 'An explicit description.');
  flowChart('Chain root', stage, 'chain-root')
    .addFunction('Line A', stage, 'chain-a', 'First line.')
    .addFunction('Line B', stage, 'chain-b');
  // builder.addSubFlowChartNext('comment-only', child, 'Not a declaration');
  const misleading = ".addSubFlowChartNext('string-only', child, 'Not a declaration')";
  const unrelated = {
    addSubFlowChartNext(_id: string, _chart: unknown, _name: string) { return this; },
    addFunction(_name: string, _fn: unknown, _id: string) { return this; },
  };
  unrelated.addSubFlowChartNext('local-lookalike', child, 'An ordinary local method');
  unrelated.addFunction('Local lookalike', stage, 'local-stage');
  void misleading;
  return builder.build();
}

interface StructuralPort {
  addSubFlowChartNext(id: string, chart: unknown, name: string): unknown;
  addFunction(name: string, fn: () => void, id?: string, description?: string): unknown;
}
declare const structural: StructuralPort;
structural.addSubFlowChartNext('unresolved-port', {}, 'Not proved to be the engine');
structural.addFunction('Implicit port stage', stage);

export function mutableLabels() {
  const labels = { id: 'old-id', description: 'Old stage description.' };
  labels.id = 'new-id';
  labels.description = 'New stage description.';
  const options = { description: 'Old options description.' };
  options.description = 'New options description.';
  flowChart('Mutable chart properties', stage, labels.id, options)
    .addFunction('Mutable stage properties', stage, labels.id, labels.description);
}

export function partiallyBoundMethods() {
  const child = flowChart('Partial child', stage, 'partial-child').build();
  const builder = flowChart('Partial root', stage, 'partial-root');
  const append = builder.addSubFlowChartNext.bind(builder, 'bound-prefix-mount-id');
  append(child, 'Remaining mount label');
  const add = builder.addFunction.bind(builder, 'Bound stage name', stage, 'bound-prefix-stage-id');
  add('Remaining description');
  builder.addSubFlowChartNext.bind(builder, 'immediate-prefix-mount-id')(child, 'Immediate mount label');
  builder.addFunction.bind(builder, 'Immediate stage name', stage, 'immediate-prefix-stage-id')('Immediate description');
}

export function spreadBoundMethod() {
  const child = flowChart('Spread child', stage, 'spread-child').build();
  const builder = flowChart('Spread root', stage, 'spread-root');
  const bindArgs = [builder, 'spread-bound-id'] as const;
  const append = builder.addSubFlowChartNext.bind(...bindArgs);
  append(child, 'Spread label');
}

export function computedDescriptions(key: string) {
  flowChart('Computed literal option', stage, 'computed-literal-option', {
    ['description']: 'Computed literal text.',
  });
  const descriptionKey = 'description';
  flowChart('Computed constant option', stage, 'computed-constant-option', {
    [descriptionKey]: 'Computed constant-key text.',
  });
  flowChart('Computed unknown option', stage, 'computed-unknown-option', {
    [key]: 'May describe the chart.',
  });
  flowChart('Computed accessor option', stage, 'computed-accessor-option', {
    get ['description']() { throw new Error('Never execute an options accessor.'); },
  });
}
`;

const otherSource = `import { flowChart } from 'footprintjs';
export function buildOther() {
  const stage = () => { throw new Error('Never execute the other stage.'); };
  const child = flowChart('Other child', stage, 'other-child').build();
  return flowChart('Other root', stage, 'other-root')
    .addSubFlowChartNext('other-file', child, 'Other child')
    .build();
}
`;

let fixture: string;
let inventory: Inventory;
const atLine = (fragment: string) =>
  source.split('\n').findIndex((line) => line.includes(fragment)) + 1;
const stageFor = (id: string) => inventory.stages.find((row) => row.id === id);

beforeAll(async () => {
  fixture = mkdtempSync(join(tmpdir(), 'agentfootprint-chart-map-'));
  mkdirSync(join(fixture, 'src'));
  symlinkSync(join(repository, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  writeFileSync(
    join(fixture, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'commonjs',
        moduleResolution: 'node',
        strict: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'node_modules'],
    }),
  );
  // Create files opposite their lexical order; the filesystem order is not the map order.
  writeFileSync(join(fixture, 'src/z-last.ts'), otherSource);
  writeFileSync(join(fixture, 'src/chart.ts'), source);
  writeFileSync(
    join(fixture, 'src/ignored.test.ts'),
    `import { flowChart } from 'footprintjs';
const child = flowChart('Ignored child', () => {}, 'ignored-child').build();
flowChart('Ignored test', () => {}, 'ignored-test').addSubFlowChartNext('excluded-test', child);
`,
  );
  inventory = await collectChartMap(fixture);
});

afterAll(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

describe('chart-map source declarations', () => {
  it('retains conditional, loop and repeated-ID mount declarations without running them', () => {
    const repeated = inventory.mounts.filter((row) => row.id === 'repeat');
    expect(repeated).toHaveLength(2);
    expect(repeated.every((row) => row.certainty === 'engine')).toBe(true);
    expect(repeated.map((row) => row.line)).toEqual([
      atLine("builder = builder.addSubFlowChartNext('repeat', child, 'Conditional child')"),
      atLine("builder = builder.addSubFlowChartNext('repeat', child, name)"),
    ]);
    expect(repeated[0].context.join(' ')).toContain('enabled');
    expect(repeated[1].context.join(' ')).toMatch(/for|name/);
    expect(repeated.every((row) => row.owner.includes('buildFixture'))).toBe(true);
    expect(inventory.mounts.find((row) => row.id === 'lazy')).toMatchObject({
      method: 'addLazySubFlowChartNext',
      certainty: 'engine',
    });
  });

  it('keeps both engine methods behind a bound conditional alias and marks structural ports unresolved', () => {
    const bound = inventory.mounts.filter((row) => row.id === 'bound');
    expect(bound).toHaveLength(1);
    expect(bound[0].method.split(' | ').sort()).toEqual(['addSubFlowChart', 'addSubFlowChartNext']);
    expect(bound[0].certainty).toBe('engine');
    expect(bound[0].line).toBe(atLine("builder = append('bound'"));
    expect(bound[0].context.join(' ')).toContain('fork');
    expect(inventory.mounts.find((row) => row.id === 'unresolved-port')).toMatchObject({
      method: 'addSubFlowChartNext',
      certainty: 'unresolved',
    });
    expect(inventory.stages.find((row) => row.name === 'Implicit port stage')).toMatchObject({
      id: '[implicit]',
      certainty: 'unresolved',
    });
  });

  it('distinguishes literal, empty, absent and expression source arguments without inferring a built description', () => {
    expect(stageFor('known')?.description).toEqual({
      state: 'literal',
      text: 'Literal description.',
    });
    expect(stageFor('absent')?.description.state).toBe('absent');
    expect(stageFor('blank')?.description.state).toBe('literal');
    expect(stageFor('blank')?.description.text.trim()).toBe('');
    expect(stageFor('computed')?.description.state).toBe('expression');
    expect(stageFor('computed')?.description.text).toContain('description');
    expect(inventory.stages.find((row) => row.name === 'Dynamic id')?.id).toBe(
      '[expression] dynamicId',
    );
  });

  it('uses each chained method token line and excludes comments, strings, tests and implemented lookalikes', () => {
    expect(stageFor('chain-a')?.line).toBe(atLine(".addFunction('Line A'"));
    expect(stageFor('chain-b')?.line).toBe(atLine(".addFunction('Line B'"));
    const ids = [...inventory.mounts, ...inventory.stages].map((row) => row.id);
    expect(ids).not.toContain('comment-only');
    expect(ids).not.toContain('string-only');
    expect(ids).not.toContain('excluded-test');
    expect(ids).not.toContain('local-lookalike');
    expect(ids).not.toContain('local-stage');
    expect(
      [...inventory.mounts, ...inventory.stages].every((row) => !row.file.endsWith('.test.ts')),
    ).toBe(true);
  });

  it('renders deterministically in source order and names the limits of a source inventory', async () => {
    expect(await collectChartMap(fixture)).toEqual(inventory);
    for (const rows of [inventory.mounts, inventory.stages]) {
      expect(rows.map((row) => row.file)).toEqual(rows.map((row) => row.file).sort());
      for (let index = 1; index < rows.length; index++) {
        if (rows[index - 1].file === rows[index].file) {
          expect(rows[index].line).toBeGreaterThanOrEqual(rows[index - 1].line);
        }
      }
    }
    const rendered = renderChartMap(inventory);
    expect(renderChartMap(inventory)).toBe(rendered);
    expect(rendered).toMatch(/source declarations/i);
    expect(rendered).toMatch(/unresolved/i);
    expect(rendered).toMatch(/empty/i);
    expect(rendered).toMatch(/absent|not supplied|not declared/i);
    expect(rendered).toMatch(/expression/i);
  });

  it('escapes Markdown and HTML in source-derived labels', () => {
    const row: MountRow = {
      file: 'src/a|<script>.ts',
      line: 7,
      owner: 'build`map',
      method: 'addSubFlowChartNext',
      id: 'id|`literal',
      context: ['if ("<script>")'],
      certainty: 'engine',
      target: 'child`value',
      mountName: 'Mount | <script>danger</script>\n|Injected|',
    };
    const rendered = renderChartMap({ mounts: [row], stages: [] });
    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;');
    expect(rendered).toContain('\\|');
    expect(rendered).not.toContain('\n|Injected|');
  });

  it('keeps mutated const-object properties and options descriptions as expressions', () => {
    const chart = inventory.stages.find((row) => row.name === 'Mutable chart properties');
    const stage = inventory.stages.find((row) => row.name === 'Mutable stage properties');
    expect(chart?.id).toBe('[expression] labels.id');
    expect(chart?.description.state).toBe('expression');
    expect(chart?.description.text).toContain('options');
    expect(stage?.id).toBe('[expression] labels.id');
    expect(stage?.description.state).toBe('expression');
    expect(stage?.description.text).toContain('labels.description');
  });

  it('marks alias and immediate partial binds as unknown instead of shifting invocation arguments', () => {
    const mountLines = [
      atLine("  append(child, 'Remaining mount label')"),
      atLine("builder.addSubFlowChartNext.bind(builder, 'immediate-prefix-mount-id')"),
    ];
    const stageLines = [
      atLine("  add('Remaining description')"),
      atLine("builder.addFunction.bind(builder, 'Immediate stage name'"),
    ];
    for (const line of mountLines) {
      const row = inventory.mounts.find((entry) => entry.line === line);
      expect(row).toBeDefined();
      expect(row?.method).toBe('addSubFlowChartNext');
      expect(row?.id).toMatch(/^\[expression\]|unknown/i);
      expect(row?.target).toMatch(/^\[expression\]|unknown/i);
      expect(row?.mountName).toMatch(/^\[expression\]|unknown/i);
      expect(row?.context.join(' ')).toContain('partially bound');
    }
    for (const line of stageLines) {
      const row = inventory.stages.find((entry) => entry.line === line);
      expect(row).toBeDefined();
      expect(row?.method).toBe('addFunction');
      expect(row?.id).toMatch(/^\[expression\]|unknown/i);
      expect(row?.name).toMatch(/^\[expression\]|unknown/i);
      expect(row?.description.state).toBe('expression');
      expect(row?.description.text.length).toBeGreaterThan(0);
      expect(row?.context.join(' ')).toContain('partially bound');
    }
  });

  it('reads literal computed description keys and retains unknown keys and accessors as expressions', () => {
    expect(stageFor('computed-literal-option')?.description).toEqual({
      state: 'literal',
      text: 'Computed literal text.',
    });
    expect(stageFor('computed-constant-option')?.description).toEqual({
      state: 'literal',
      text: 'Computed constant-key text.',
    });
    expect(stageFor('computed-unknown-option')?.description.state).toBe('expression');
    expect(stageFor('computed-unknown-option')?.description.text).toContain('key');
    expect(stageFor('computed-accessor-option')?.description.state).toBe('expression');
    expect(stageFor('computed-accessor-option')?.description.text).toContain('description');
  });

  it('preserves source backticks as escaped Markdown rather than literal numeric entities', () => {
    const row: MountRow = {
      file: 'src/plain.ts',
      line: 1,
      owner: 'build`map',
      method: 'addSubFlowChartNext',
      id: 'id`literal',
      context: ['value === `literal`'],
      certainty: 'engine',
      target: 'child`value',
      mountName: 'A | <tag> label',
    };
    const rendered = renderChartMap({ mounts: [row], stages: [] });
    for (const label of [row.owner, row.id, row.context[0], row.target]) {
      expect(rendered).toContain(label.replaceAll('`', '\\`'));
    }
    expect(rendered).not.toMatch(/&#(?:0*96|x0*60);|&grave;/i);
    expect(rendered).not.toContain('<tag>');
    expect(rendered).toContain('&lt;tag&gt;');
    expect(rendered).toContain('\\|');
  });

  it('keeps native spread-bind argument layout unknown without applying its tuple', () => {
    const rows = inventory.mounts.filter(
      (row) => row.line === atLine("  append(child, 'Spread label')"),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.method).toBe('addSubFlowChartNext');
    expect(row.certainty).toBe('engine');
    expect(row.id).toMatch(/^\[expression\]|unknown/i);
    expect(row.target).toMatch(/^\[expression\]|unknown/i);
    expect(row.mountName).toMatch(/^\[expression\]|unknown/i);
    expect(row.context.join(' ')).toMatch(/partially bound|spread/i);
  });
});

it('keeps docs/chart-map.md byte-identical to the generated production inventory', async () => {
  const current = await collectChartMap(repository);
  expect(readFileSync(join(repository, 'docs/chart-map.md'), 'utf8')).toBe(renderChartMap(current));
});
