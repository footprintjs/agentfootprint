/** One contract, with fixed real commands and separately owned install ports. */
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  checkInstalledContext,
  checkPackedContext,
  readSourceOracle,
  setupIdentity,
  sha256,
} from './oracle.mjs';
import { createProbes, probeState, removeProbes } from './files.mjs';
import { renderContextProbes } from './probes.mjs';
import { registryInstallers } from './registry.mjs';
import {
  CASES,
  PROTOCOL,
  validateGuardReceipt,
  validateHandle,
  validatePairedInput,
} from './protocol.mjs';

const INNER_REFS = ['source', 'install', 'inputs', 'graph'];
const PRODUCER_REFS = [...INNER_REFS, 'build'];
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const asError = (value) =>
  value instanceof Error
    ? value
    : new Error('Context operation threw a non-Error value.', { cause: value });
const combine = (primary, secondary) =>
  primary !== undefined
    ? new AggregateError([primary, asError(secondary)], primary.message, { cause: primary })
    : asError(secondary);
const executionOf = (error) => ({
  exitCode: Number.isInteger(error?.status) ? error.status : null,
  signal: typeof error?.signal === 'string' ? error.signal : null,
});

function disjoint(a, b) {
  const contains = (left, right) => {
    const path = relative(left, right);
    return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
  };
  return !contains(a, b) && !contains(b, a);
}

/** Private composition seam for adjacent unit fixtures, unreachable through paired input. */
export function createContractRunner(ownerRoot, commands) {
  async function run(input, paired) {
    if (paired) validatePairedInput(input);
    const installers = {
      source: input.installSourceRoot,
      consumer: input.installPackedConsumer,
      verifySource: input.verifySource,
    };
    const sourceProof = paired ? structuredClone(input.producerProofRefs.source) : null;
    const sourceRoot = await realpath(ownerRoot);
    assert.equal(await realpath(input.sourceRoot), sourceRoot, 'Contract source owner mismatch.');
    const parent = await realpath(input.ownedWorkRoot);
    assert.equal(parent, resolve(input.ownedWorkRoot), 'Work root must not be an alias.');
    assert.ok((await lstat(parent)).isDirectory() && disjoint(sourceRoot, parent));
    assert.deepEqual(await readdir(parent), [], 'Work root must be empty.');
    const oracle = await readSourceOracle(sourceRoot);
    if (paired)
      assert.deepEqual(
        oracle.identity,
        {
          manifestSha256: input.source.manifestSha256,
          lockSha256: input.source.lockSha256,
        },
        'Original source documents changed.',
      );
    const source = paired ? structuredClone(input.source) : { ...oracle.identity };
    const temporary = await realpath(await mkdtemp(join(parent, 'context-run-')));
    const evidence = {
      protocol: PROTOCOL,
      mode: paired ? 'paired' : 'registry-control',
      complete: false,
      source,
      sourceVersion: oracle.metadata.version,
      cases: [],
      producerCommands: [],
      contextArtifact: null,
    };
    let failure;
    let artifact = null;
    try {
      for (const family of ['source', 'consumer']) await mkdir(join(temporary, `${family}-cache`));

      async function unchangedSource() {
        assert.deepEqual(
          await setupIdentity(sourceRoot),
          oracle.identity,
          'Original source documents changed.',
        );
        if (artifact)
          assert.equal(
            sha256(await readFile(artifact.path)),
            artifact.sha256,
            'Context artifact changed.',
          );
      }

      async function boundaryGuard(context, command, phase, execution, present) {
        async function checkLocalFacts() {
          await unchangedSource();
          if (context.caseId !== null) {
            assert.deepEqual(
              await setupIdentity(context.root),
              context.setup,
              'Installed setup changed.',
            );
            await checkInstalledContext(context.root, oracle);
            if (context.agent) await probeState(context.agent, context.probes, present);
          }
        }
        await checkLocalFacts();
        const boundary = freeze({
          protocol: PROTOCOL,
          source: structuredClone(source),
          caseId: context.caseId,
          rootRealPath: context.root,
          command,
          phase,
          execution,
          probes: [...present],
        });
        if (!paired) return null;
        const verify = context.caseId === null ? installers.verifySource : context.handle.verify;
        const receipt = await verify(boundary);
        validateGuardReceipt(
          receipt,
          boundary,
          context.setup,
          context.caseId === null ? PRODUCER_REFS : INNER_REFS,
        );
        assert.deepEqual(receipt.proofRefs.source, sourceProof, 'Guard source proof changed.');
        await checkLocalFacts();
        return structuredClone(receipt);
      }

      async function command(context, id, present = []) {
        const record = { command: id, before: null, execution: null, after: null };
        context.records.push(record);
        record.before = await boundaryGuard(context, id, 'before-command', null, present);
        let result;
        let commandFailure;
        try {
          result = await commands.execute(id, { root: context.root, temporary });
          assert.equal(typeof result.stdout, 'string');
          assert.equal(typeof result.stderr, 'string');
          record.execution = { exitCode: 0, signal: null };
          record.stdout = result.stdout;
          record.stderr = result.stderr;
        } catch (error) {
          commandFailure = asError(error);
          record.execution = executionOf(error);
          record.stdout = String(error?.stdout ?? '');
          record.stderr = String(error?.stderr ?? '');
        }
        try {
          record.after = await boundaryGuard(
            context,
            id,
            'after-command',
            record.execution,
            present,
          );
        } catch (error) {
          commandFailure = combine(commandFailure, error);
        }
        if (commandFailure) throw commandFailure;
        return result.stdout;
      }

      async function runCase(caseId) {
        const consumer = caseId.startsWith('consumer-');
        const root = join(temporary, caseId);
        await mkdir(root);
        const probes = consumer ? renderContextProbes(root, paired) : [];
        const request = freeze({
          protocol: PROTOCOL,
          source: structuredClone(source),
          caseId,
          rootRealPath: root,
          originalManifestText: oracle.packageText,
          originalLockText: oracle.lockText,
          policy: {
            omitDev: true,
            scripts: false,
            peers: paired ? 'strict' : 'registry-control',
            offline: caseId.endsWith('-offline'),
          },
          cache: {
            family: consumer ? 'consumer' : 'source',
            realPath: join(temporary, `${consumer ? 'consumer' : 'source'}-cache`),
          },
          contextArtifact: artifact ? { ...artifact } : null,
          probes,
        });
        const installer = consumer ? installers.consumer : installers.source;
        const supplied = await installer(request);
        let handle = null;
        if (paired) {
          validateHandle(supplied, request);
          handle = Object.freeze({
            receipt: freeze(structuredClone(supplied.receipt)),
            verify: supplied.verify,
          });
          assert.deepEqual(
            handle.receipt.proofRefs.source,
            sourceProof,
            'Install source proof changed.',
          );
        }
        const setup = await setupIdentity(root);
        if (paired)
          assert.deepEqual(setup, handle.receipt.setup, 'Install receipt setup mismatch.');
        const row = {
          caseId,
          installation: handle ? structuredClone(handle.receipt) : null,
          setup,
          context: null,
          commands: [],
          restored: null,
          complete: false,
        };
        evidence.cases.push(row);
        const context = {
          caseId,
          root,
          handle,
          setup,
          probes,
          records: row.commands,
          agent: consumer ? join(root, 'node_modules', 'agentfootprint') : null,
        };
        const owned = [];
        let caseFailure;
        try {
          row.context = await checkInstalledContext(root, oracle);
          if (!consumer) await command(context, 'source-cjs');
          else {
            const installedAgent = JSON.parse(
              await readFile(join(context.agent, 'package.json'), 'utf8'),
            );
            assert.equal(
              installedAgent.dependencies.contextfootprint,
              oracle.metadata.dependencies.contextfootprint,
            );
            assert.equal(installedAgent.version, artifact.sourceVersion);
            await probeState(context.agent, probes, []);
            const runtime = probes.filter((probe) => probe.phase === 'runtime-and-types');
            await createProbes(context.agent, runtime, owned);
            await command(context, 'packed-cjs', runtime);
            await command(context, 'packed-esm', runtime);
            await createProbes(
              context.agent,
              probes.filter((probe) => probe.phase === 'types-only'),
              owned,
            );
            await command(context, 'packed-types', probes);
          }
        } catch (error) {
          caseFailure = asError(error);
        } finally {
          try {
            await removeProbes(owned);
          } catch (error) {
            caseFailure = combine(caseFailure, error);
          }
          try {
            row.restored = await boundaryGuard(context, null, 'after-cleanup', null, []);
          } catch (error) {
            caseFailure = combine(caseFailure, error);
          }
        }
        if (caseFailure) throw caseFailure;
        row.complete = true;
      }

      await runCase(CASES[0]);
      await runCase(CASES[1]);
      const packedText = await command(
        {
          caseId: null,
          root: sourceRoot,
          setup: oracle.identity,
          records: evidence.producerCommands,
        },
        'source-pack',
      );
      const packedRows = JSON.parse(packedText);
      assert.ok(Array.isArray(packedRows) && packedRows.length === 1);
      const [packed] = packedRows;
      assert.ok(
        typeof packed.filename === 'string' && basename(packed.filename) === packed.filename,
      );
      assert.equal(packed.name, oracle.metadata.name);
      assert.equal(packed.version, oracle.metadata.version);
      assert.ok(Array.isArray(packed.files));
      checkPackedContext(packed.files);
      const archive = join(temporary, packed.filename);
      const stat = await lstat(archive);
      assert.ok(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.nlink === 1 &&
          (await realpath(archive)) === resolve(archive) &&
          stat.size <= 32 * 1024 * 1024,
        'Context artifact must be a regular file within the native AF archive bound.',
      );
      artifact = freeze({
        path: archive,
        sha256: sha256(await readFile(archive)),
        sourceVersion: oracle.metadata.version,
      });
      evidence.contextArtifact = { ...artifact };
      await runCase(CASES[2]);
      await runCase(CASES[3]);
      await unchangedSource();
      assert.deepEqual(
        evidence.cases.map((row) => row.caseId),
        CASES,
      );
      assert.ok(evidence.cases.every((row) => row.complete));
      const checkedCommands = [...evidence.producerCommands];
      assert.deepEqual(
        evidence.producerCommands.map((record) => record.command),
        ['source-pack'],
      );
      for (const row of evidence.cases) {
        assert.deepEqual(
          row.commands.map((record) => record.command),
          row.caseId.startsWith('source-')
            ? ['source-cjs']
            : ['packed-cjs', 'packed-esm', 'packed-types'],
        );
        checkedCommands.push(...row.commands);
        if (paired) assert.ok(row.restored, 'Missing restored-root evidence.');
      }
      assert.ok(
        checkedCommands.every(
          (record) =>
            record.execution?.exitCode === 0 &&
            record.execution.signal === null &&
            (!paired || (record.before && record.after)),
        ),
        'Missing or failed command boundary.',
      );
      evidence.complete = true;
    } catch (error) {
      failure = asError(error);
    } finally {
      try {
        await rm(temporary, { recursive: true, force: true });
      } catch (error) {
        failure = combine(failure, error);
        evidence.complete = false;
      }
    }
    if (failure) {
      evidence.complete = false;
      const error = new Error(failure.message ?? String(failure), { cause: failure });
      error.contextPackageEvidence = evidence;
      throw error;
    }
    return evidence;
  }

  return {
    async runPaired(input) {
      return run(input, true);
    },
    async runRegistry() {
      const parent = await realpath(
        await mkdtemp(join(tmpdir(), 'agentfootprint-context-package-')),
      );
      try {
        return await run(
          { sourceRoot: ownerRoot, ownedWorkRoot: parent, ...registryInstallers() },
          false,
        );
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
  };
}
