import type { SiteMessageKey } from '../../i18n/i18n';
import type { DOCS_GROUP_ORDER } from './docs-nav';

/**
 * Sidebar group headings are English frontmatter values (they also decide the order); the visible
 * label is a catalog key (spec 101). A heading the catalog does not know yet is shown as written, so a
 * new group is never relabelled or hidden.
 */
const GROUP_LABELS: Readonly<Record<(typeof DOCS_GROUP_ORDER)[number] | 'Guides', SiteMessageKey>> =
  {
    'Getting started': 'docs.groups.Getting started',
    Project: 'docs.groups.Project',
    'Content modelling': 'docs.groups.Content modelling',
    'Server APIs': 'docs.groups.Server APIs',
    'Client & deploy': 'docs.groups.Client & deploy',
    Guides: 'docs.groups.Guides'
  };

export function docsGroupLabel(t: (key: SiteMessageKey) => string, heading: string): string {
  const key = GROUP_LABELS[heading as keyof typeof GROUP_LABELS];
  return key === undefined ? heading : t(key);
}
