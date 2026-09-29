import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { icons } from 'lucide-react';
import { createElement } from 'react';
import { splitApiTree } from './api-tree.mjs';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  // The shared sidebar is serialized into every route. Its unused source-file
  // lookup refs repeat thousands of bytes; names, URLs, IDs and content stay intact.
  pageTree: { noRef: true },
  // Resolve `icon` strings in meta.json (folder groups + sub-section separators) to
  // lucide-react icons, e.g. "icon": "Hammer" or a separator "---[Boxes]Primitives---".
  icon(icon) {
    if (!icon) return undefined;
    if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
    return undefined;
  },
});

/**
 * The sidebar trees, split so no page serializes every API symbol
 * (lib/api-tree.mjs has the measurement and the rule). Guide pages get
 * `guideTree`; `/docs/api/*` pages get `apiTree`.
 */
export const navTrees = splitApiTree(source.getPageTree());
