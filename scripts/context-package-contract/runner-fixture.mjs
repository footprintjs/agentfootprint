/** Controller unit plumbing only: no install, tar validation, runtime or compiler execution. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContractRunner } from './runner.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => structuredClone(value);
const innerKeys = ['source', 'install', 'inputs', 'graph'];
const allKeys = [...innerKeys, 'build'];
export const probePaths = [
  '.context-smoke.cjs',
  '.context-smoke.mjs',
  '.context-types.mts',
  '.context-types.cts',
];
const proof = (keys) =>
  Object.fromEntries(keys.map((id) => [id, { id: `fixture:${id}`, sha256: hash(id) }]));

async function json(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

async function identity(root) {
  return {
    manifestSha256: hash(await readFile(join(root, 'package.json'))),
    lockSha256: hash(await readFile(join(root, 'package-lock.json'))),
  };
}

async function installedProbes(root) {
  const found = [];
  for (const path of probePaths) {
    try {
      const bytes = await readFile(join(root, 'node_modules', 'agentfootprint', path));
      found.push({ path, size: bytes.length, sha256: hash(bytes), body: bytes.toString('utf8') });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return found;
}

export async function runnerFixture(t, hooks = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'af-context-runner-unit-')));
  t.after(async () => {
    await rm(base, { recursive: true, force: true });
  });
  const sourceRoot = join(base, 'source');
  const ownedWorkRoot = join(base, 'work');
  await mkdir(sourceRoot);
  await mkdir(ownedWorkRoot);
  await writeFile(join(base, 'keep-parent.txt'), 'parent belongs to fixture\n');
  await writeFile(join(sourceRoot, 'keep-source.txt'), 'source belongs to fixture\n');
  const metadata = {
    name: 'agentfootprint',
    version: '14.7.2',
    dependencies: { contextfootprint: '0.1.1' },
  };
  // Synthetic metadata is sufficient for controller/oracle checks, never archive proof.
  const context = {
    version: '0.1.1',
    resolved: 'https://registry.npmjs.org/contextfootprint/-/contextfootprint-0.1.1.tgz',
    integrity:
      'sha512-' + Buffer.from('synthetic fixture metadata, not registry bytes').toString('base64'),
  };
  const lock = {
    name: metadata.name,
    version: metadata.version,
    lockfileVersion: 3,
    packages: { '': metadata, 'node_modules/contextfootprint': context },
  };
  await json(join(sourceRoot, 'package.json'), metadata);
  await json(join(sourceRoot, 'package-lock.json'), lock);
  const sourceSetup = await identity(sourceRoot);
  const source = { head: 'a'.repeat(40), tree: 'b'.repeat(40), ...sourceSetup };
  const producerProofRefs = proof(allKeys);
  const events = [];
  const requests = [];
  const setups = new Map();
  const f = {
    base,
    sourceRoot,
    ownedWorkRoot,
    metadata,
    context,
    source,
    sourceSetup,
    producerProofRefs,
    events,
    requests,
    setups,
    json,
    identity,
    async assertPreserved(assert) {
      assert.equal(
        await readFile(join(base, 'keep-parent.txt'), 'utf8'),
        'parent belongs to fixture\n',
      );
      assert.equal(
        await readFile(join(sourceRoot, 'keep-source.txt'), 'utf8'),
        'source belongs to fixture\n',
      );
      assert.deepEqual(await readdir(ownedWorkRoot), []);
    },
  };

  async function verify(boundary) {
    events.push({
      kind: 'guard',
      boundary: clone(boundary),
      actualProbes: await installedProbes(boundary.rootRealPath),
    });
    const receipt = {
      boundary: clone(boundary),
      setup: clone(boundary.caseId === null ? sourceSetup : setups.get(boundary.caseId)),
      proofRefs: proof(boundary.caseId === null ? allKeys : innerKeys),
    };
    if (hooks.guard) return (await hooks.guard(boundary, receipt, f)) ?? receipt;
    return receipt;
  }

  async function install(request) {
    requests.push(request);
    events.push({
      kind: 'install',
      request: clone(request),
      cacheBefore: await readdir(request.cache.realPath),
    });
    const root = request.rootRealPath;
    await json(
      join(root, 'package.json'),
      request.caseId.startsWith('source-')
        ? metadata
        : {
            name: 'fixture-consumer',
            version: '1.0.0',
            private: true,
            dependencies: { agentfootprint: `file:${request.contextArtifact.path}` },
          },
    );
    await json(join(root, 'package-lock.json'), {
      lockfileVersion: 3,
      packages: { '': { name: 'fixture-setup' } },
    });
    const modules = join(root, 'node_modules');
    await mkdir(join(modules, 'contextfootprint'), { recursive: true });
    await json(join(modules, 'contextfootprint', 'package.json'), {
      name: 'contextfootprint',
      version: context.version,
    });
    await json(join(modules, '.package-lock.json'), {
      lockfileVersion: 3,
      packages: { 'node_modules/contextfootprint': context },
    });
    if (request.caseId.startsWith('consumer-')) {
      await mkdir(join(modules, 'agentfootprint'));
      await json(join(modules, 'agentfootprint', 'package.json'), metadata);
    }
    if (!request.policy.offline)
      await writeFile(join(request.cache.realPath, 'unit-cache-marker'), request.cache.family);
    const setup = await identity(root);
    setups.set(request.caseId, setup);
    const handle = {
      receipt: {
        protocol: request.protocol,
        source: clone(request.source),
        caseId: request.caseId,
        rootRealPath: root,
        setup,
        policy: clone(request.policy),
        cache: clone(request.cache),
        installExitCode: 0,
        contextArtifact: clone(request.contextArtifact),
        proofRefs: proof(innerKeys),
      },
      verify,
    };
    if (hooks.install) return (await hooks.install(request, handle, f)) ?? handle;
    return handle;
  }

  const commands = {
    async execute(id, args) {
      events.push({
        kind: 'command',
        id,
        root: args.root,
        actualProbes: await installedProbes(args.root),
      });
      if (hooks.command) {
        const result = await hooks.command(id, args, f);
        if (result !== undefined) return result;
      }
      if (id === 'source-pack') {
        await writeFile(
          join(args.temporary, 'fixture.tgz'),
          'controller fixture only; not a tar archive\n',
        );
        return {
          stdout: JSON.stringify([
            {
              name: metadata.name,
              version: metadata.version,
              filename: 'fixture.tgz',
              files: [{ path: 'package.json' }],
            },
          ]),
          stderr: '',
        };
      }
      return { stdout: `unit command adapter: ${id}\n`, stderr: '' };
    },
  };
  f.input = {
    sourceRoot,
    ownedWorkRoot,
    source,
    producerProofRefs,
    installSourceRoot: install,
    installPackedConsumer: install,
    verifySource: verify,
  };
  f.run = (value = f.input) => createContractRunner(sourceRoot, commands).runPaired(value);
  return f;
}

export async function rejected(run) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the controller fixture to refuse.');
}

export function errorTree(error) {
  const seen = new Set();
  const result = [];
  const visit = (value) => {
    if (!(value instanceof Error) || seen.has(value)) return;
    seen.add(value);
    result.push(value);
    visit(value.cause);
    if (value instanceof AggregateError) for (const child of value.errors) visit(child);
  };
  visit(error);
  return result;
}
