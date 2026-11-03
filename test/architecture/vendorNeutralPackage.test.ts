/** Exercise the package bytes and resolution rules that consumers receive. */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { LLMResponse } from '../../src/index.js';

const ROOT = resolve(__dirname, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'af-vendor-neutral-'));
const localResponse: LLMResponse = {
  content: 'local answer',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
};
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60_000 });
  expect(result.error, `${command}: ${String(result.error)}`).toBeUndefined();
  expect(result.status, `${command}: ${result.stderr}\n${result.stdout}`).toBe(0);
  return result.stdout;
}

describe('packed vendor-neutral package', () => {
  it('keeps both built root graphs vendor-free and runs local defaults with no optional peers', async () => {
    expect(
      existsSync(join(ROOT, 'dist/index.js')),
      'Build the library before packaging checks.',
    ).toBe(true);
    const [packed] = JSON.parse(
      run(
        'npm',
        [
          'pack',
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          scratch,
          '--cache',
          join(scratch, 'npm-cache'),
        ],
        ROOT,
      ),
    ) as Array<{ filename: string }>;
    expect(packed).toBeDefined();
    const consumer = join(scratch, 'consumer');
    const modules = join(consumer, 'node_modules');
    const packageRoot = join(modules, 'agentfootprint');
    mkdirSync(packageRoot, { recursive: true });
    run(
      'tar',
      ['-xzf', join(scratch, packed!.filename), '--strip-components=1', '-C', packageRoot],
      ROOT,
    );
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
      exports: Record<
        string,
        {
          require: { default: string };
          import: { default: string };
        }
      >;
    };
    // Install the already locked required dependency closure, without a
    // registry call or a parent node_modules that could hide missing peers.
    const required = new Set([
      ...Object.keys(pkg.dependencies),
      ...Object.keys(pkg.peerDependencies).filter(
        (name) => pkg.peerDependenciesMeta[name]?.optional !== true,
      ),
    ]);
    const copied = new Set<string>();
    const copyRequired = (name: string): void => {
      if (copied.has(name)) return;
      copied.add(name);
      const source = join(ROOT, 'node_modules', name);
      const dep = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      };
      cpSync(source, join(modules, name), {
        recursive: true,
        filter: (path) => !path.slice(source.length).split(/[\\/]/).includes('node_modules'),
      });
      for (const child of Object.keys(dep.dependencies ?? {})) copyRequired(child);
      for (const child of Object.keys(dep.peerDependencies ?? {})) {
        if (dep.peerDependenciesMeta?.[child]?.optional !== true) copyRequired(child);
      }
    };
    for (const name of required) copyRequired(name);
    const optional = Object.keys(pkg.peerDependenciesMeta).filter(
      (name) => pkg.peerDependenciesMeta[name]?.optional,
    );
    const codeDoors = Object.entries(pkg.exports)
      .filter(([, entry]) => typeof entry === 'object')
      .map(([name]) => (name === '.' ? 'agentfootprint' : `agentfootprint/${name.slice(2)}`));
    for (const name of optional) expect(existsSync(join(modules, name)), name).toBe(false);

    const typeProbe = `
      import { Agent, inMemoryArtifacts, type ArtifactStore, type LLMProvider } from 'agentfootprint';
      import { s3Artifacts, gcsArtifacts, AdapterConfigurationError, type AdapterConfigurationAdapter, type AdapterConfigurationReason, type S3ArtifactsOptions, type GcsArtifactsOptions } from 'agentfootprint/artifacts';
      import { AdapterConfigurationError as MemoryError } from 'agentfootprint/memory';
      import { AdapterConfigurationError as ObserveError } from 'agentfootprint/observe';
      import { AdapterConfigurationError as HostingError } from 'agentfootprint/hosting';
      import { AdapterConfigurationError as ProviderError } from 'agentfootprint/providers';
      import { providerFromEnv, type ProviderFromEnv } from 'agentfootprint/providers';
      const s3: S3ArtifactsOptions = { bucket: 'a', endpoint: 'https://objects.example.test', forcePathStyle: true };
      const gcs: GcsArtifactsOptions = { bucket: 'a' };
      const store: ArtifactStore = inMemoryArtifacts();
      const provider: LLMProvider = { name: 'local', complete: async () => (${JSON.stringify(
        localResponse,
      )}) };
      const agent = Agent.create({ provider, model: 'local', artifacts: store }).build();
      const env: ProviderFromEnv = providerFromEnv({ fallbackToMock: true });
      void [s3Artifacts, gcsArtifacts, s3, gcs, env, agent, MemoryError, ObserveError, HostingError, ProviderError];
      const reason: AdapterConfigurationReason = 'conflicting-options';
      const adapter: AdapterConfigurationAdapter = 'RedisStore';
      const error = new AdapterConfigurationError(adapter, reason);
      const code: 'ERR_ADAPTER_CONFIGURATION' = error.code;
      void code;
      // @ts-expect-error Closed diagnostic reason.
      new AdapterConfigurationError(adapter, 'backend-error-text');
      // @ts-expect-error Closed adapter identifier.
      new AdapterConfigurationError('arbitrary-backend-name');
      // @ts-expect-error Internal capture helper is not a public export.
      import { captureAdapterConstruction } from 'agentfootprint/artifacts';
      // @ts-expect-error Category error does not widen the neutral root.
      import { AdapterConfigurationError as RootError } from 'agentfootprint';
      // @ts-expect-error Removed root value.
      import { s3Artifacts as removedS3 } from 'agentfootprint';
      // @ts-expect-error Removed root value.
      import { gcsArtifacts as removedGcs } from 'agentfootprint';
      // @ts-expect-error Removed root value.
      import { providerFromEnv as removedEnv } from 'agentfootprint';
      // @ts-expect-error Removed root type.
      import type { S3ArtifactsOptions as RemovedS3Options } from 'agentfootprint';
      // @ts-expect-error Removed root type.
      import type { GcsArtifactsOptions as RemovedGcsOptions } from 'agentfootprint';
      // @ts-expect-error Removed root type.
      import type { ProviderFromEnv as RemovedEnvResult } from 'agentfootprint';
      // @ts-expect-error Removed root type.
      import type { CreateProviderOptions as RemovedCreate } from 'agentfootprint';
      // @ts-expect-error Removed root type.
      import type { ProviderKind as RemovedKind } from 'agentfootprint';
    `;
    for (const extension of ['cts', 'mts'])
      writeFileSync(join(consumer, `probe.${extension}`), typeProbe);
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ['ES2022', 'DOM', 'ESNext.Disposable'],
          types: ['node'],
          typeRoots: [join(ROOT, 'node_modules/@types')],
        },
        include: ['probe.cts', 'probe.mts'],
      }),
    );
    run(
      process.execPath,
      [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')],
      consumer,
    );

    for (const mode of ['require', 'import'] as const) {
      const entry = pkg.exports['.']![mode].default;
      const { metafile } = await build({
        absWorkingDir: packageRoot,
        entryPoints: [entry],
        bundle: true,
        treeShaking: false,
        packages: 'external',
        platform: 'node',
        format: 'esm',
        write: false,
        metafile: true,
      });
      const files = Object.keys(metafile.inputs);
      expect(
        files.some((file) => /\/core\/Agent\.js$/.test(file)),
        mode,
      ).toBe(true);
      expect(
        files.filter((file) =>
          /\/(?:adapters|embedders)\/|\/artifacts\/(?:s3|gcs)Artifacts\.js$/.test(file),
        ),
        `${mode} packed root reaches a vendor implementation`,
      ).toEqual([]);
      const sdkImports = Object.entries(metafile.inputs).flatMap(([from, input]) =>
        input.imports
          .filter(
            (edge) =>
              edge.external &&
              optional.some((name) => edge.path === name || edge.path.startsWith(`${name}/`)),
          )
          .map((edge) => `${from}: ${edge.path}`),
      );
      expect(sdkImports, `${mode} packed root loads an optional SDK`).toEqual([]);
      const script = `
        const assert = ${
          mode === 'require'
            ? "require('node:assert/strict')"
            : "(await import('node:assert/strict')).default"
        };
        const { createRequire, registerHooks } = ${
          mode === 'require' ? "require('node:module')" : "await import('node:module')"
        };
        const localRequire = createRequire(${JSON.stringify(join(consumer, 'probe.cjs'))});
        for (const name of ${JSON.stringify(optional)}) {
          assert.throws(() => localRequire.resolve(name), { code: 'MODULE_NOT_FOUND' });
        }
        const attemptedSdkLoads = [];
        const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
          if (${JSON.stringify(
            optional,
          )}.some(name => specifier === name || specifier.startsWith(name + '/'))) {
            attemptedSdkLoads.push(specifier);
            const error = new Error('Optional SDK import attempted during module load');
            error.code = 'MODULE_NOT_FOUND';
            throw error;
          }
          return nextResolve(specifier, context);
        }});
        const api = ${
          mode === 'require' ? "localRequire('agentfootprint')" : "await import('agentfootprint')"
        };
        for (const name of ['s3Artifacts', 'gcsArtifacts', 'providerFromEnv', 'AdapterConfigurationError']) {
          assert.equal(Object.hasOwn(api, name), false);
        }
        for (const door of ${JSON.stringify(codeDoors)}) {
          ${mode === 'require' ? 'localRequire(door);' : 'await import(door);'}
        }
        assert.deepEqual(attemptedSdkLoads, [], 'No optional SDK load may be attempted at import time');
        hooks.deregister();
        const artifacts = ${
          mode === 'require'
            ? "localRequire('agentfootprint/artifacts')"
            : "await import('agentfootprint/artifacts')"
        };
        const cjsErrors = localRequire('agentfootprint/artifacts');
        const esmErrors = await import('agentfootprint/artifacts');
        assert.notEqual(cjsErrors.AdapterConfigurationError, esmErrors.AdapterConfigurationError);
        let configurationError;
        try {
          cjsErrors.s3Artifacts({ bucket: 'a', client: { send: async () => ({}) }, region: 'private-region' });
        } catch (error) { configurationError = error; }
        assert.ok(configurationError instanceof cjsErrors.AdapterConfigurationError);
        assert.equal(configurationError instanceof esmErrors.AdapterConfigurationError, false);
        assert.equal(configurationError.code, new esmErrors.AdapterConfigurationError('s3Artifacts').code);
        assert.equal(configurationError.reason, 'conflicting-options');
        assert.equal(configurationError.adapter, 's3Artifacts');
        for (const door of ['artifacts', 'memory', 'providers', 'observe', 'hosting']) {
          assert.equal(localRequire('agentfootprint/' + door).AdapterConfigurationError, cjsErrors.AdapterConfigurationError);
          assert.equal((await import('agentfootprint/' + door)).AdapterConfigurationError, esmErrors.AdapterConfigurationError);
        }
        assert.throws(() => artifacts.s3Artifacts({ bucket: 'a' }), /s3Artifacts requires.*client-s3/s);
        assert.throws(() => artifacts.s3Artifacts({ bucket: 'a', client: { send: async () => ({}) } }), /s3Artifacts requires.*client-s3/s);
        for (const options of [{ region: 'r' }, { endpoint: 'https://objects.example.test' }, { forcePathStyle: true }, { forcePathStyle: false }]) {
          assert.throws(() => artifacts.s3Artifacts({ bucket: 'a', client: { send: async () => ({}) }, ...options }),
            { name: 'AdapterConfigurationError', code: 'ERR_ADAPTER_CONFIGURATION', adapter: 's3Artifacts', reason: 'conflicting-options' });
        }
        assert.throws(() => artifacts.gcsArtifacts({ bucket: 'a' }), /gcsArtifacts requires.*google-cloud\\/storage/s);
        assert.throws(() => artifacts.gcsArtifacts({ bucket: 'a', storage: { bucket: () => ({}) }, projectId: 'project' }),
          { name: 'AdapterConfigurationError', code: 'ERR_ADAPTER_CONFIGURATION', adapter: 'gcsArtifacts', reason: 'conflicting-options' });
        assert.equal(typeof artifacts.gcsArtifacts({ bucket: 'a', storage: { bucket: () => ({}) } }).put, 'function');
        const scope = { tenant: 't', principal: 'p', conversationId: 'c' };
        const stores = [api.inMemoryArtifacts(),
          api.fileArtifacts({ directory: ${JSON.stringify(join(consumer, `files-${mode}`))} }),
          api.sqliteArtifacts({ file: ${JSON.stringify(join(consumer, `artifacts-${mode}.db`))} })];
        for (const store of stores) {
          const { meta } = await store.put(scope, { kind: 'text', mediaType: 'text/plain', data: 'local payload' });
          assert.equal((await store.get(scope, meta.ref)).data, 'local payload');
          if (typeof store.close === 'function') store.close();
        }
        const provider = { name: 'local-proof', complete: async () => (${JSON.stringify(
          localResponse,
        )}) };
        const agent = api.Agent.create({ provider, model: 'local', artifacts: stores[0] }).build();
        assert.equal(await agent.run({ message: 'hello' }), 'local answer');
        console.log('LOCAL_DEFAULT_AGENT_OK');
      `;
      const wrapped =
        mode === 'require'
          ? `(async () => { ${script} })().catch(error => { console.error(error); process.exitCode = 1; });`
          : script;
      const output = run(
        process.execPath,
        [...(mode === 'import' ? ['--input-type=module'] : []), '-e', wrapped],
        consumer,
      );
      expect(output).toContain('LOCAL_DEFAULT_AGENT_OK');
    }
  }, 120_000);
});
