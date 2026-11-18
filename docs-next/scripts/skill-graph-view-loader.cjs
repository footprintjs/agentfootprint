const { build } = require('esbuild');
const { dirname, resolve } = require('node:path');

// Webpack otherwise shares the Lens root with the full inspector on a different
// page. Compile this one public import on its own, then let the site bundler
// resolve React, ReactFlow, CSS and all other peer packages as usual.
async function bundleView(entry) {
  return build({
    absWorkingDir: dirname(entry),
    entryPoints: [entry],
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    bundle: true,
    treeShaking: true,
    metafile: true,
    write: false,
    plugins: [{
      name: 'share-site-packages',
      setup(builder) {
        builder.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.kind === 'entry-point' || args.path === 'agentfootprint-lens' ||
              args.path.startsWith('agentfootprint-lens/')) return;
          return { path: args.path, external: true };
        });
      },
    }],
  });
}

module.exports = function skillGraphViewLoader() {
  const done = this.async();
  const entry = this.resourcePath;
  bundleView(entry).then((result) => {
    for (const input of Object.keys(result.metafile.inputs)) this.addDependency(resolve(dirname(entry), input));
    done(null, result.outputFiles[0].text);
  }).catch(done);
};

module.exports.bundleView = bundleView;
