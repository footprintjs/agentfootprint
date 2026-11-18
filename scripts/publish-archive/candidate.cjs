'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { inspectFile } = require('./verify.cjs');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function regular(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'candidate requires regular files');
  return fs.readFileSync(file);
}

// Data-only admission of a separate ordinary pack. Never stage a version or
// execute an incoming archive, helper, lifecycle, installer or publisher here.
function retainCandidate(root, output, sourceHead) {
  assert.match(sourceHead, /^[a-f0-9]{40}$/);
  root = fs.realpathSync(root);
  assert(fs.lstatSync(output).isDirectory() && !fs.lstatSync(output).isSymbolicLink());
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const sourceTree = git('rev-parse', sourceHead + '^{tree}');
  const tested = { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') };
  assert.equal(tested.tree, sourceTree, 'candidate must use the exact source tree');
  // Generators may rewrite identical bytes. Compare content with HEAD rather
  // than treating the index's stale stat cache as a source change. Check the
  // index separately: restored working bytes must not hide a staged mutation.
  git('diff', '--cached', '--quiet', 'HEAD', '--');
  git('diff', '--quiet', 'HEAD', '--');
  const manifest = regular(path.join(root, 'package.json'));
  const lock = regular(path.join(root, 'package-lock.json'));
  const sourceFile = (name) => execFileSync('git', ['show', sourceHead + ':' + name], { cwd: root });
  assert.deepEqual(manifest, sourceFile('package.json'));
  assert.deepEqual(lock, sourceFile('package-lock.json'));
  const metadata = JSON.parse(manifest);
  const names = fs.readdirSync(output);
  assert(names.length === 1 && names[0].endsWith('.tgz'), 'one original archive required');
  const archive = path.join(output, names[0]);
  const result = inspectFile(archive, metadata, metadata.version);
  for (const member of result.report.files) {
    const file = path.join(root, member.path.slice('package/'.length));
    assert(fs.realpathSync(file).startsWith(root + path.sep), 'member escaped source root');
    const bytes = regular(file);
    assert.equal(bytes.length, member.size, 'packed member size differs: ' + member.path);
    assert.equal(sha256(bytes), member.sha256, 'packed member differs: ' + member.path);
  }
  const record = {
    protocol: 'agentfootprint.source-candidate.v1',
    source: { head: sourceHead, tree: sourceTree, manifestSha256: sha256(manifest), lockSha256: sha256(lock) },
    tested,
    archive: { filename: names[0], ...result.report },
  };
  fs.writeFileSync(path.join(output, 'source-package.json'), manifest, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'source-package-lock.json'), lock, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'candidate.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return record;
}

module.exports = { retainCandidate };
if (require.main === module) {
  assert.equal(process.argv.length, 4);
  const result = retainCandidate(process.cwd(), process.argv[2], process.argv[3]);
  console.log(JSON.stringify({ head: result.source.head, tree: result.source.tree, version: result.archive.version, sha256: result.archive.sha256 }));
}
