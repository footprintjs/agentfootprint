/**
 * Two navigation trees from the one page tree, so no page carries every API symbol.
 *
 * The docs layout serializes its sidebar tree into EVERY page of the static
 * export (the HTML and the route's RSC payloads). With the generated API
 * reference listed symbol by symbol (~680 pages), that tree was most of every
 * page's bytes: a 12 KB API page shipped ~890 KB, and a guide page ~1 MB.
 *
 * - `guideTree` — the full tree without its `fallback` (Fumadocs copies every
 *   unlisted page there, the whole API reference included); if the API folder
 *   is listed in the main tree it is cut down as below.
 * - `apiTree` — the API folder cut down to its kind folders (Classes,
 *   Functions, …), each keeping only its index page — the whole tree, for API
 *   pages.
 *   A symbol page is not in it by design; the tree's root then IS the API
 *   folder, so the sidebar shows the API reference, not the guides.
 *
 * Every symbol page keeps its URL, and is reached from its kind's index page,
 * from search, and from TypeDoc's own cross-links.
 */

/** @param {any} folder */
function trimApiFolder(folder) {
  return {
    ...folder,
    // A kind folder becomes a plain link to its index page: an emptied folder
    // would still draw an expand arrow that opens nothing.
    children: folder.children.map((child) =>
      child.type === 'folder' ? child.index ?? { ...child, children: [] } : child,
    ),
  };
}

/** @param {any} node @param {string} apiUrl */
function isApiFolder(node, apiUrl) {
  // A sidebar ROOT (meta.json `root: true`) — a guide folder can LINK to the
  // API landing page too (the Reference section does), and must not match.
  return (
    node.type === 'folder' &&
    node.root === true &&
    (node.index?.url === apiUrl || node.children.some((c) => c.type === 'page' && c.url === apiUrl))
  );
}

/**
 * @param {any} tree the loader's page tree (`source.getPageTree()`)
 * @param {string} [apiUrl] the API reference's landing URL
 */
export function splitApiTree(tree, apiUrl = '/docs/api') {
  // The API folder is a sidebar ROOT that the top-level meta.json does not
  // list, so Fumadocs files it under `fallback` — the copy of every unlisted
  // page that it also serializes into each page. Look in both places.
  const inMain = tree.children.find((node) => isApiFolder(node, apiUrl));
  const inFallback = tree.fallback?.children?.find((node) => isApiFolder(node, apiUrl));
  const api = inMain ?? inFallback;
  const guideTree = { ...tree, fallback: undefined };
  if (!api) return { guideTree, apiTree: undefined };
  const trimmed = trimApiFolder(api);
  if (inMain) {
    guideTree.children = tree.children.map((node) => (node === api ? trimmed : node));
  }
  const apiTree = {
    type: 'root',
    $id: 'api-root',
    name: trimmed.name,
    children: trimmed.index ? [trimmed.index, ...trimmed.children] : trimmed.children,
  };
  return { guideTree, apiTree };
}
