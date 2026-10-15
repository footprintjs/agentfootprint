'use strict';
/**
 * eslint-import-resolver.cjs — how `import/no-restricted-paths` finds the file an import names.
 *
 * The layer zones (`layering.config.cjs` · `layerZones`) list FILES, so the lint is only as
 * good as its resolution of `'../core/Agent.js'` to `src/core/Agent.ts`. An import the
 * resolver cannot place is skipped by the rule in silence, so this resolver asks the same
 * law the checker asks (`layering.config.cjs` · `resolveRelative`): the lint and
 * `npm run check:layering` cannot disagree about which file an import names. A bare package
 * specifier is not ours to place: `found: false`, and the zones never name a package.
 *
 * eslint-plugin-import resolver interface, version 2.
 */
const fs = require('fs');
const path = require('path');
const { resolveRelative } = require('./layering.config.cjs');

const ROOT = path.resolve(__dirname, '..');

const isFile = (relPath) => {
  const full = path.join(ROOT, relPath);
  return fs.existsSync(full) && fs.statSync(full).isFile();
};

exports.interfaceVersion = 2;

exports.resolve = (source, file) => {
  const from = path.relative(ROOT, file).split(path.sep).join('/');
  const hit = resolveRelative(from, source, isFile);
  return hit === null ? { found: false } : { found: true, path: path.join(ROOT, hit) };
};
