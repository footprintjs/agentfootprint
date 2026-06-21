/**
 * remark plugin: resolve `doc:<id>` links to real routes at build time.
 *
 *   [Skills](doc:skills)            -> [Skills](/docs/build/skills)
 *   [why](doc:why#the-new-class)    -> [why](/docs/getting-started/why#the-new-class)
 *
 * The id -> route map is derived from the filesystem (see lib/doc-ids.mjs), so moving a
 * page between taxonomy folders updates every link automatically. An unknown id THROWS,
 * failing the build — a dead cross-reference can never ship.
 *
 * The map is built once per process and memoised; `next build` runs this against the
 * current tree, so the resolved URLs always reflect the live taxonomy.
 */
import { visit } from 'unist-util-visit';
import { buildIdMap } from './doc-ids.mjs';

let MAP;
function idMap() {
  if (!MAP) MAP = buildIdMap();
  return MAP;
}

export function remarkDocLinks() {
  return (tree, file) => {
    const map = idMap();
    visit(tree, 'link', (node) => {
      const url = node.url;
      if (typeof url !== 'string' || !url.startsWith('doc:')) return;
      const [id, anchor] = url.slice('doc:'.length).split('#');
      const entry = map.get(id);
      if (!entry) {
        const where = file?.path ? ` (in ${file.path})` : '';
        throw new Error(
          `[remark-doc-links] unknown doc id "${id}" -> ${url}${where}. ` +
            `Use one of the filename slugs under content/docs, or link with a real /docs/... path.`,
        );
      }
      node.url = entry.route + (anchor ? `#${anchor}` : '');
    });
  };
}

export default remarkDocLinks;
