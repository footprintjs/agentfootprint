import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { collectChartMap, renderChartMap } from '../../scripts/chart-map/index.mjs';

let root: string;
const text = `import { flowChart } from 'footprintjs';
const fn = () => { throw new Error('Do not execute source'); };
export function build() {
  const b = flowChart('Root', fn, 'root');
  if (true) {
    b.addFunction('First', fn, 'repeat');
    b.addFunction('Second', fn, 'repeat');
  }
  const options = { branch: () => b.addFunction('Property', fn, 'property') };
  const segment = () => { return (builder: typeof b) =>
    builder.addFunction('Returned', fn, 'returned'); };
  new Promise(() => b.addFunction('Executor', fn, 'executor'));
  const callbacks = [() => b.addFunction('Array', fn, 'array')];
  class Consumer { field = () => b.addFunction('Field', fn, 'field'); }
  void options; void segment; void callbacks; void Consumer;
}
if (true) { const conditionalOwner = () => flowChart('Conditional owner', fn, 'conditional-owner'); }
`;
let inventory: ReturnType<typeof collectChartMap>;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'hci-map-symbols-'));
  mkdirSync(join(root, 'src'));
  symlinkSync(join(resolve(__dirname, '../..'), 'node_modules'), join(root, 'node_modules'));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'commonjs',
        moduleResolution: 'node',
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }),
  );
  writeFileSync(join(root, 'src/chart.ts'), text);
  inventory = collectChartMap(root);
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

it('keeps committed output byte-identical when comments and blank lines move declarations', () => {
  const before = renderChartMap(inventory);
  writeFileSync(
    join(root, 'src/chart.ts'),
    '// Unrelated header\n\n' +
      text.replace('if (true) {', 'if (true) {\n\n// Unrelated inner comment\n'),
  );
  try {
    expect(renderChartMap(collectChartMap(root))).toBe(before);
  } finally {
    writeFileSync(join(root, 'src/chart.ts'), text);
  }
  expect(before).not.toMatch(/#L\d+|at line \d+|chart\.ts:\d+/);
  expect(before).toContain('src/chart.ts');
  expect(before).toContain('build');
});

it('distinguishes duplicate ids by stable source-order occurrence rather than a line', () => {
  const output = renderChartMap(inventory);
  expect(output).toMatch(/repeat #2/);
  expect(output.indexOf('First')).toBeLessThan(output.indexOf('Second'));
});

it('refuses a resolved engine method absent from both classification lists', () => {
  writeFileSync(
    join(root, 'src/unclassified.ts'),
    "import { flowChart } from 'footprintjs'; flowChart('S', () => {}, 's').budget(1);",
  );
  try {
    expect(() => collectChartMap(root)).toThrow(
      /explicit declaration\/non-declaration classification:[\s\S]*budget/,
    );
  } finally {
    rmSync(join(root, 'src/unclassified.ts'));
  }
});

it.each([
  ['property', /ArrowFunction.*property branch/],
  ['returned', /ArrowFunction.*ReturnStatement/],
  ['executor', /callback \(new Promise\)/],
  ['array', /ArrowFunction.*ArrayLiteralExpression/],
  ['field', /ArrowFunction.*property field/],
])('names the enclosing function boundary for %s', (id, boundary) => {
  const row = inventory.stages.find((entry) => entry.id === id);
  expect(row).toBeDefined();
  expect(row.context.join(' ')).toMatch(boundary);
  expect(renderChartMap({ mounts: [], stages: [row] })).not.toContain(
    'No recorded enclosing source control',
  );
});

it('retains source conditions outside a named owner without treating its own arrow as nested', () => {
  const row = inventory.stages.find((entry) => entry.id === 'conditional-owner');
  expect(row.context.join(' ')).toContain('if (true)');
  expect(row.context.join(' ')).not.toContain('Inside function');
});
