'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { inspectArchive, archiveRefusalCode } = require('./archive.cjs');
const failures = new WeakMap();
const archiveLimits = Object.freeze({
  maxArchiveBytes: 32 * 1024 * 1024,
  maxFiles: 20000,
  maxExpandedBytes: 128 * 1024 * 1024,
});
function fail(code) {
  const error = new Error('publish-archive-refused');
  failures.set(error, code);
  throw error;
}
function versionTag(version) {
  if (typeof version !== 'string') fail('manifest-version');
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-rc\.(0|[1-9][0-9]*))?$/.exec(
    version,
  );
  if (
    !match ||
    match[0] !== version ||
    match
      .slice(1)
      .filter((x) => x !== undefined)
      .some((x) => !Number.isSafeInteger(Number(x)))
  )
    fail('manifest-version');
  return match[4] === undefined ? 'latest' : 'next';
}
function inspectFile(file, sourceManifest, version) {
  versionTag(version);
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > archiveLimits.maxArchiveBytes
  )
    fail('archive-input');
  const bytes = fs.readFileSync(file);
  const report = inspectArchive(bytes, {
    package: 'agentfootprint',
    version,
    sourceManifest,
    ...archiveLimits,
  });
  return { bytes, report, tag: versionTag(report.version) };
}
function stageCheckedArchive(input, directory, sourceManifest, version) {
  const result = inspectFile(input, sourceManifest, version);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(directory).length !== 0)
    fail('archive-directory');
  // Write the validated in-memory bytes once. No extraction, second source read,
  // overwrite, lifecycle call or helper from the incoming artifact.
  fs.writeFileSync(path.join(directory, 'package.tgz'), result.bytes, { flag: 'wx', mode: 0o600 });
  return result;
}
function refusalCode(error) {
  return failures.get(error) || archiveRefusalCode(error) || 'archive-input';
}
function main(argv, env) {
  try {
    if (!['inspect', 'stage'].includes(argv[0]) || argv.length !== (argv[0] === 'stage' ? 3 : 2))
      fail('archive-input');
    const sourceManifest = JSON.parse(env.SOURCE_MANIFEST);
    const result =
      argv[0] === 'stage'
        ? stageCheckedArchive(argv[1], argv[2], sourceManifest, env.PLANNED_VERSION)
        : inspectFile(argv[1], sourceManifest, env.PLANNED_VERSION);
    process.stdout.write(
      'version=' +
        result.report.version +
        '\nnpmtag=' +
        result.tag +
        '\nsha256=' +
        result.report.sha256 +
        '\n',
    );
    return 0;
  } catch (error) {
    process.stdout.write('::error::' + refusalCode(error) + '\n');
    return 1;
  }
}
module.exports = { versionTag, inspectFile, stageCheckedArchive, refusalCode, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);
