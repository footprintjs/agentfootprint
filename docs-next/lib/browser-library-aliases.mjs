import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Find the named owner of a naturally resolved entry, including unnamed ESM package scopes. */
function packageOwner(issuer, name) {
  const entry = realpathSync(createRequire(issuer).resolve(name));
  for (let root = dirname(entry); ; root = dirname(root)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (manifest?.name !== undefined) {
      assert.equal(manifest.name, name, `unexpected package owner for ${name}`);
      return { root, entry, manifest };
    }
    assert.notEqual(root, dirname(root), `missing package owner for ${name}`);
  }
}

function browserEntry(owner, door, target) {
  const value = target?.import?.default;
  assert.equal(typeof value, 'string', `${owner.manifest.name}${door}: unsupported browser export`);
  assert(
    value.startsWith('./'),
    `${owner.manifest.name}${door}: browser export must be package-relative`,
  );
  const file = realpathSync(resolve(owner.root, value));
  const path = relative(owner.root, file);
  assert(
    path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path),
    'browser export escapes package owner',
  );
  assert(statSync(file).isFile(), 'browser export must be a file');
  return file;
}

/** Follow docs' actual AF owner; aliases must not conceal a second engine or reader image. */
export function resolveBrowserLibraries(docsRoot) {
  const docsIssuer = join(realpathSync(docsRoot), 'package.json');
  const agent = packageOwner(docsIssuer, 'agentfootprint');
  const agentBrowser = browserEntry(agent, '.', agent.manifest.exports?.['.']);
  const selected = Object.fromEntries(
    ['footprintjs', 'foottrace'].map((name) => [name, packageOwner(agentBrowser, name)]),
  );
  // In linked development the docs and parent really have separate installs.
  // The client aliases deliberately select the linked AF owner's dependencies.
  const linkedParent = agent.root === dirname(realpathSync(docsRoot));
  const issuers = linkedParent ? [agent.entry] : [docsIssuer, agent.entry];
  for (const [name, owner] of Object.entries(selected)) {
    for (const issuer of issuers) {
      assert.equal(packageOwner(issuer, name).root, owner.root, `divergent ${name} package owner`);
    }
  }
  const engine = selected.footprintjs;
  for (const issuer of [engine.entry, browserEntry(engine, '.', engine.manifest.exports?.['.'])]) {
    assert.equal(
      packageOwner(issuer, 'foottrace').root,
      selected.foottrace.root,
      'divergent engine reader package owner',
    );
  }
  const aliases = Object.fromEntries(
    Object.values(selected).flatMap((owner) => {
      const name = owner.manifest.name;
      return Object.entries(owner.manifest.exports)
        .filter(
          ([door, target]) =>
            door !== './package.json' && !(typeof target === 'string' && target.endsWith('.json')),
        )
        .map(([door, target]) => {
          assert(door === '.' || door.startsWith('./'), `${name}: unsupported browser export map`);
          return [
            door === '.' ? name : `${name}/${door.slice(2)}`,
            browserEntry(owner, door, target),
          ];
        });
    }),
  );
  return {
    agentRoot: agent.root,
    owners: Object.fromEntries(Object.entries(selected).map(([name, owner]) => [name, owner.root])),
    aliases,
  };
}
