import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { importedFoottrace } from './foottrace.imports.mjs';
import { assertSingleFoottrace } from './foottrace.install.mjs';

const require = createRequire(import.meta.url);
const imported = importedFoottrace();
const runtime = [
  ...new Set(
    imported.filter((item) => !item.typeOnly).map((item) => `${item.module}:${item.name}`),
  ),
].sort();
const modules = Object.fromEntries(
  await Promise.all(
    [...new Set(imported.map((item) => item.module))].map(async (name) => [
      name,
      await import(name),
    ]),
  ),
);
function contracts(ft, cause) {
  function commit(stage, idx, key, value, verb = 'set', readKeys = []) {
    return {
      idx,
      stage,
      stageId: stage,
      runtimeStageId: `${stage}#${idx}`,
      trace: [{ path: key, verb, readKeys }],
      overwrite: { [key]: value },
      updates: {},
      redactedPaths: [],
    };
  }
  const log = [
    commit('seed', 0, 'input', 2),
    commit('answer', 1, 'answer', 4, 'set', ['input']),
    commit('rewrite', 2, 'input', 9),
  ];
  const reads = (id) => (id === 'answer#1' ? ['input'] : []);
  const chain = () => ft.causalChain(log, 'answer#1', reads);
  const slice = () => ft.sliceForKey(log, 'answer', reads);
  const births = [
    commit('start', 0, 'history', ['a']),
    commit('append', 1, 'history', ['b'], 'append'),
  ];
  const address = { logRunId: 'contract', drillPath: [] };
  function graph() {
    return cause.createRecordGraph([
      {
        address,
        commitLog: log,
        reads: { 'seed#0': [], 'answer#1': ['input'], 'rewrite#2': [] },
        attention: {},
        controlDeps: {},
        complete: true,
      },
    ]);
  }
  const cases = {
    'foottrace:CommitRangeIndex': () => {
      const index = new ft.CommitRangeIndex();
      const outer = index.open('outer', 0),
        inner = index.open('inner', 1);
      index.close(inner, 2);
      assert.deepEqual(
        index.enclosing(2).map((row) => row.label),
        ['outer', 'inner'],
      );
      index.close(outer, 3);
      assert.deepEqual(
        index.overlapping(3, 4).map((row) => row.label),
        ['outer'],
      );
      index.clear();
      assert.deepEqual(index.enclosing(2), []);
    },
    'foottrace:HONESTY_CODES': () => {
      assert.equal(Object.isFrozen(ft.HONESTY_CODES), true);
      for (const code of [
        'redacted',
        'truncated',
        'never-written',
        'reads-not-recorded',
        'from-initial-state',
      ])
        assert.equal(typeof ft.HONESTY_CODES[code], 'string');
    },
    'foottrace:REQUIREMENT_RESULT_LIMITS': () => {
      assert.equal(Object.isFrozen(ft.REQUIREMENT_RESULT_LIMITS), true);
      assert.equal(ft.REQUIREMENT_RESULT_LIMITS.refs, 16);
      assert.equal(typeof ft.REQUIREMENT_RESULT_LIMITS.name, 'number');
    },
    'foottrace:applySmartMerge': () => {
      let state = { retained: true };
      for (const bundle of births)
        state = ft.applySmartMerge(state, bundle.updates, bundle.overwrite, bundle.trace);
      assert.deepEqual(state, { retained: true, history: ['a', 'b'] });
      assert.deepEqual(births[1].overwrite.history, ['b']);
    },
    'foottrace:arrayProvenance': () => {
      assert.deepEqual(
        ft
          .arrayProvenance(births, 'history')
          .births.map((row) => [row.value, row.commitIdx, row.basis]),
        [
          ['a', 0, 'whole-value'],
          ['b', 1, 'append-verb'],
        ],
      );
      assert.equal(ft.arrayProvenance(log, 'missing').missing, 'never-written');
    },
    'foottrace:causalChain': () => {
      assert.equal(chain().parents[0].runtimeStageId, 'seed#0');
      assert.equal(ft.causalChain(log, 'absent#0', reads), undefined);
      assert.equal(ft.causalChain(log, 'answer#1', reads, { maxNodes: 1 }).truncated.byNodes, true);
    },
    'foottrace:commitStops': () =>
      assert.deepEqual(
        ft.commitStops(log).map((stop) => stop.kind),
        ['start', 'commit', 'commit', 'commit', 'end'],
      ),
    'foottrace:commitValueAt': () => {
      assert.equal(ft.commitValueAt(log, 1, 'input'), 2);
      assert.deepEqual(ft.commitValueAt(births, 1, 'history'), ['a', 'b']);
    },
    'foottrace:commitValueAtWithBasis': () => {
      assert.deepEqual(ft.commitValueAtWithBasis(log, 1, 'answer'), { value: 4, basis: [] });
      assert.ok(ft.commitValueAtWithBasis(log, 1, 'missing').basis.includes('never-written'));
      const redacted = [{ ...log[0], redactedPaths: ['input'], overwrite: { input: 'REDACTED' } }];
      assert.ok(ft.commitValueAtWithBasis(redacted, 0, 'input').basis.includes('redacted'));
    },
    'foottrace:elementProvenance': () => {
      assert.equal(ft.elementProvenance(births, 'history', 1).runtimeStageId, 'append#1');
      assert.equal(ft.elementProvenance(births, 'history', 2), undefined);
    },
    'foottrace:filterStops': () => {
      const stops = ft.filterStops(ft.commitStops(log), (stop) =>
        stop.runtimeStageId === 'answer#1' ? {} : null,
      );
      assert.deepEqual(
        stops.map((stop) => stop.kind),
        ['start', 'commit', 'end'],
      );
      assert.equal(stops[1].lastCommitIdx, 2);
    },
    'foottrace:findLastWriter': () => {
      assert.equal(ft.findLastWriter(log, 'input', 2), log[0]);
      assert.equal(ft.findLastWriter(log, 'input'), log[2]);
      assert.equal(ft.findLastWriter(log, 'missing'), undefined);
    },
    'foottrace:findLastWriterWithBasis': () => {
      assert.deepEqual(ft.findLastWriterWithBasis(log, 'input', 2), { writer: log[0], basis: [] });
      assert.deepEqual(ft.findLastWriterWithBasis(log, 'missing').basis, ['never-written']);
    },
    'foottrace:flattenCausalDAG': () =>
      assert.deepEqual(
        ft.flattenCausalDAG(chain()).map((node) => node.runtimeStageId),
        ['answer#1', 'seed#0'],
      ),
    'foottrace:formatCausalChain': () => assert.match(ft.formatCausalChain(chain()), /seed#0/),
    'foottrace:formatSlice': () => {
      assert.match(ft.formatSlice(slice()), /answer/);
      assert.match(ft.formatSlice(ft.sliceForKey(log, 'absent', reads)), /never/);
    },
    'foottrace:forwardSliceForKey': () => {
      const forward = ft.forwardSliceForKey(log, 'input', reads, { before: 1 });
      assert.equal(forward.root.runtimeStageId, 'seed#0');
      assert.equal(forward.root.reads[0].runtimeStageId, 'answer#1');
      assert.equal(forward.root.fedEdges[0].child.runtimeStageId, 'answer#1');
    },
    'foottrace:keyTimeline': () => {
      const timeline = ft.keyTimeline(log, 'input', reads);
      assert.deepEqual(
        timeline.moments.map((moment) => [moment.kind, moment.commitIdx]),
        [
          ['write', 0],
          ['read', 1],
          ['write', 2],
        ],
      );
      assert.equal(timeline.moments[1].fromWriteIdx, 0);
    },
    'foottrace:keysReadFromExecutionTree': () => {
      const source = ft.keysReadFromExecutionTree({
        runtimeStageId: 'answer#1',
        stageReads: { input: 'not inspected' },
      });
      assert.deepEqual(source.lookup('answer#1'), ['input']);
      assert.deepEqual(source.coverage, { steps: 1, stepsWithReads: 1 });
      assert.throws(() => ft.keysReadFromExecutionTree({ stageReads: [] }), TypeError);
    },
    'foottrace:keysReadFromMap': () => {
      const source = ft.keysReadFromMap(new Map([['answer#1', ['input']]]));
      assert.deepEqual(source.lookup('answer#1'), ['input']);
      assert.deepEqual(source.lookup('missing#0'), []);
    },
    'foottrace:parseRuntimeStageId': () =>
      assert.deepEqual(ft.parseRuntimeStageId('outer/answer#12'), {
        stageId: 'answer',
        subflowPath: 'outer',
        executionIndex: 12,
      }),
    'foottrace:readRequirementResults': () => {
      const receipt = {
        id: 'result',
        requirementRef: 'requirement',
        findingRef: 'finding',
        windowRef: 'window',
        affects: ['claim'],
        state: 'unresolved',
        reason: 'not-collected',
        evidenceRefs: [],
        checks: [],
        actionRefs: [],
      };
      const admitted = ft.readRequirementResults([receipt]);
      assert.deepEqual(admitted, [receipt]);
      receipt.affects.push('later');
      assert.deepEqual(admitted[0].affects, ['claim']);
      assert.throws(() => ft.readRequirementResults([{ ...receipt, state: 'invented' }]));
    },
    'foottrace:sliceForKey': () => {
      assert.equal(slice().writer.runtimeStageId, 'answer#1');
      assert.equal(slice().root.parents[0].runtimeStageId, 'seed#0');
      assert.equal(ft.sliceForKey(log, 'missing', reads).missing, 'never-written');
    },
    'foottrace:splitStageId': () =>
      assert.deepEqual(ft.splitStageId('outer/answer'), {
        localStageId: 'answer',
        subflowPath: 'outer',
      }),
    'foottrace:stateAt': () => {
      assert.deepEqual(ft.stateAt({ initialState: { retained: true }, commitLog: log }, 1).state, {
        retained: true,
        input: 2,
        answer: 4,
      });
      assert.deepEqual(ft.stateAt({ commitLog: births }, 1).state.history, ['a', 'b']);
    },
    'foottrace/cause:createRecordGraph': async () => {
      const g = graph();
      const id = g.nodeId(address, { runtimeStageId: 'answer#1', commitIdx: 1, key: 'answer' });
      const parent = g.nodeId(address, { runtimeStageId: 'seed#0', commitIdx: 0, key: 'input' });
      assert.deepEqual(
        (await g.parents(id, { signal: new AbortController().signal })).edges.map(
          (edge) => edge.nodeId,
        ),
        [parent],
      );
    },
    'foottrace/cause:attentionList': async () => {
      const g = graph();
      const result = await cause.attentionList(g, {
        nodeIds: await g.openScope(address, { signal: new AbortController().signal }),
      });
      assert.equal(result.confidence, 'incomplete');
      assert.ok(result.gaps.some((gap) => gap.code === 'not-collected'));
      assert.deepEqual(result.nodes, []);
    },
    'foottrace/cause:explain': async () => {
      const g = graph();
      const id = g.nodeId(address, { runtimeStageId: 'answer#1', commitIdx: 1, key: 'answer' });
      const result = await cause.explain(g, id, { maxNodes: 10, maxDepth: 5 });
      assert.equal(result.confidence, 'complete');
      assert.equal(result.rootCause, undefined);
      const stopped = await cause.explain(g, id, { signal: AbortSignal.abort() });
      assert.equal(stopped.confidence, 'incomplete');
      assert.ok(stopped.gaps.some((gap) => gap.code === 'cancelled'));
    },
  };

  return cases;
}

test('the installed consumer and footprintjs share one physical Foottrace image', () => {
  assertSingleFoottrace();
});

function withInstallFixture(behavior) {
  const directory = mkdtempSync(join(tmpdir(), 'foottrace-install-contract-'));
  function installed(name, parent = directory) {
    const location = join(parent, 'node_modules', name);
    mkdirSync(location, { recursive: true });
    writeFileSync(
      join(location, 'package.json'),
      JSON.stringify({ name, version: '1.11.0', main: 'index.cjs' }),
    );
    // Resolution data only. No fixture module is imported or executed.
    writeFileSync(join(location, 'index.cjs'), '// Inert package-resolution fixture.\n');
    return location;
  }
  try {
    const manifest = join(directory, 'package.json');
    writeFileSync(manifest, '{"private":true}\n');
    const root = installed('foottrace');
    const engine = installed('footprintjs');
    behavior({ directory, manifest, root, engine, installed });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('physical singleton control accepts a deduped installation', () => {
  withInstallFixture(({ manifest, root }) => {
    const image = realpathSync(join(root, 'index.cjs'));
    assert.deepEqual(assertSingleFoottrace(manifest), { root: image, footprintjs: image });
  });
});

test('physical singleton control accepts a symlink alias to the same image', () => {
  withInstallFixture(({ manifest, root, engine }) => {
    mkdirSync(join(engine, 'node_modules'));
    symlinkSync(root, join(engine, 'node_modules/foottrace'), 'junction');
    const image = realpathSync(join(root, 'index.cjs'));
    assert.deepEqual(assertSingleFoottrace(manifest), { root: image, footprintjs: image });
  });
});

test('physical singleton control refuses a nested copy with identical version and bytes', () => {
  withInstallFixture(({ manifest, root, engine, installed }) => {
    const nested = installed('foottrace', engine);
    for (const file of ['package.json', 'index.cjs'])
      assert.deepEqual(readFileSync(join(root, file)), readFileSync(join(nested, file)));
    const consumer = createRequire(manifest);
    const engineRequire = createRequire(consumer.resolve('footprintjs'));
    assert.notEqual(
      realpathSync(consumer.resolve('foottrace')),
      realpathSync(engineRequire.resolve('foottrace')),
      'The fixture must demonstrate two actual physical resolutions before checking refusal',
    );
    assert.throws(() => assertSingleFoottrace(manifest), { code: 'ERR_ASSERTION' });
  });
});

test('every source-imported runtime symbol has a behavior contract, with no extra Foottrace features', () => {
  assert.deepEqual(
    Object.keys(contracts(modules.foottrace, modules['foottrace/cause'])).sort(),
    runtime,
    `Source imports:\n${JSON.stringify(imported, null, 2)}`,
  );
});
for (const mode of ['import', 'require']) {
  const cases = contracts(
    mode === 'import' ? modules.foottrace : require('foottrace'),
    mode === 'import' ? modules['foottrace/cause'] : require('foottrace/cause'),
  );
  for (const [key, behavior] of Object.entries(cases))
    test(`${mode} ${key}`, { timeout: 5000 }, async () => {
      assert.ok(
        runtime.includes(key),
        `${key} is no longer imported by source; remove its contract.`,
      );
      await behavior();
    });
}
