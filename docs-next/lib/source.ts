import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { icons } from 'lucide-react';
import { createElement } from 'react';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  // Resolve `icon` strings in meta.json (folder groups + sub-section separators) to
  // lucide-react icons, e.g. "icon": "Hammer" or a separator "---[Boxes]Primitives---".
  icon(icon) {
    if (!icon) return undefined;
    if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
    return undefined;
  },
});
