import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { incVersion, readFragments, requiredBump } from '../../../scripts/changes.mjs';

const name = 'agentfootprint-lens';
const cohort = ['agentfootprint', 'footprintjs', 'foottrace', 'footprint-explainable-ui'];
const registry = 'https://registry.npmjs.org';

export function compatibleRelease(document, selected) {
  assert.equal(document?.name, name, 'unexpected Lens registry package');
  const entries = Object.entries(document.versions);
  assert(entries.length > 0, 'missing Lens registry versions');
  for (const peer of cohort) {
    assert(
      selected[peer] && semver.valid(selected[peer]) === selected[peer],
      `invalid docs version for ${peer}`,
    );
  }
  const compatible = entries.filter(([version, manifest]) => {
    assert.equal(semver.valid(version), version, 'invalid Lens registry version');
    assert.equal(manifest.name, name, 'unexpected Lens release name');
    assert.equal(manifest.version, version, 'unexpected Lens release version');
    if (manifest.deprecated) return false;
    const peers = manifest.peerDependencies ?? {};
    assert(typeof peers === 'object' && !Array.isArray(peers), 'invalid Lens registry peers');
    for (const [peer, range] of Object.entries(peers))
      assert(
        typeof range === 'string' && semver.validRange(range),
        `invalid Lens peer range for ${peer}`,
      );
    return (
      cohort.every((peer) => Object.hasOwn(peers, peer)) &&
      Object.entries(peers).every(([peer, range]) =>
        Object.hasOwn(selected, peer)
          ? semver.satisfies(selected[peer], range)
          : manifest.peerDependenciesMeta?.[peer]?.optional === true,
      )
    );
  });
  return compatible.map(([version]) => version).sort(semver.rcompare)[0];
}

export function requireSnapshot(document, selected) {
  const compatible = compatibleRelease(document, selected);
  if (compatible) {
    throw new Error(
      `Published ${name}@${compatible} accepts the docs peers. Switch the docs dependency to npm, regenerate its lock, and remove docs-next/vendor/lens and its CI check.`,
    );
  }
}

async function registryDocument() {
  const response = await fetch(`${registry}/${name}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  return response.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url)));
  const selected = Object.fromEntries(
    Object.entries(lock.packages)
      .filter(([path, record]) => /^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(path) && record.version)
      .map(([path, record]) => [path.slice('node_modules/'.length), record.version]),
  );
  const bump = requiredBump(readFragments());
  selected.agentfootprint = bump ? incVersion(source.version, bump) : source.version;
  const document = await registryDocument().catch((cause) => {
    throw new Error('Could not determine Lens snapshot status from the npm registry', { cause });
  });
  requireSnapshot(document, selected);
  console.log(
    'Keep the Lens snapshot for',
    Object.fromEntries(cohort.map((peer) => [peer, selected[peer]])),
  );
}
