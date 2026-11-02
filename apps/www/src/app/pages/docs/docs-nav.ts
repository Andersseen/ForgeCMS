/**
 * The sidebar model for `/docs`, derived from the frontmatter of `src/content/docs/*.md`.
 *
 * Deliberately free of Angular: the component layer calls `injectContentFiles()` and hands the
 * result here, so the ordering rules — the part that actually breaks when someone adds a page — are
 * unit-testable without a TestBed. See docs/specs/043.
 */

/** Frontmatter every docs page must carry. `group`/`order` only affect where it lands in the nav. */
export interface DocsFrontmatter {
  title: string;
  description?: string;
  group?: string;
  order?: number;
}

/** The subset of `@analogjs/content`'s `ContentFile` this module needs. */
export interface DocsContentFile {
  slug: string;
  filename: string;
  attributes: Partial<DocsFrontmatter>;
}

export interface DocsNavLink {
  slug: string;
  title: string;
  description?: string;
  /** In-app path of this entry in the reader's locale (spec 101); absent in the English-only model. */
  path?: string;
  /** The reader's locale has no translation, so the entry links to the English article. */
  englishOnly?: boolean;
}

export interface DocsNavGroup {
  heading: string;
  links: DocsNavLink[];
}

/**
 * Sidebar section order. A page whose `group` is not listed here still shows up — after these, in
 * alphabetical order — so a new page is never silently invisible just because the group is new.
 */
export const DOCS_GROUP_ORDER = [
  'Getting started',
  'Project',
  'Content modelling',
  'Server APIs',
  'Client & deploy'
] as const;

const UNGROUPED = 'Guides';

/** Only pages under `src/content/docs/` — the content glob covers all of `src/content`. */
export function isDocsFile(file: DocsContentFile): boolean {
  return file.filename.includes('/content/docs/');
}

/**
 * Translated articles live in `src/content/<locale>/docs/<slug>.md` (spec 101): a separate directory
 * per locale, so a translation never shares a content id with — or replaces — the English article.
 */
export function isLocalizedDocsFile(file: DocsContentFile, locale: string): boolean {
  return file.filename.includes(`/content/${locale}/docs/`);
}

/**
 * The English nav in the reader's locale: same groups and order, the translated title and path for
 * every article that has a translation, and the English article (flagged `englishOnly`) for the rest.
 * `localize(slug, translated)` builds the in-app path.
 */
export function localizeDocsNav(
  groups: readonly DocsNavGroup[],
  translations: readonly DocsContentFile[],
  localize: (slug: string, translated: boolean) => string
): DocsNavGroup[] {
  const bySlug = new Map(translations.map((file) => [file.slug, file.attributes]));
  return groups.map((group) => ({
    heading: group.heading,
    links: group.links.map((link) => {
      const translated = bySlug.get(link.slug);
      const description = translated?.description ?? (translated ? undefined : link.description);
      return {
        slug: link.slug,
        title: translated?.title ?? link.title,
        ...(description !== undefined && { description }),
        path: localize(link.slug, translated !== undefined),
        englishOnly: translated === undefined
      };
    })
  }));
}

function groupRank(heading: string): number {
  const index = DOCS_GROUP_ORDER.indexOf(heading as (typeof DOCS_GROUP_ORDER)[number]);
  return index === -1 ? DOCS_GROUP_ORDER.length : index;
}

function compareGroups(a: string, b: string): number {
  const rank = groupRank(a) - groupRank(b);
  return rank !== 0 ? rank : a.localeCompare(b);
}

function toLink(file: DocsContentFile): DocsNavLink {
  const { title, description } = file.attributes;
  return {
    slug: file.slug,
    // A page without a title is a mistake, not a crash: fall back to the slug so it stays reachable.
    title: title ?? file.slug,
    ...(description !== undefined && { description })
  };
}

/** Pages without `order` sort after the ordered ones, alphabetically. */
function compareLinks(a: DocsContentFile, b: DocsContentFile): number {
  const orderA = a.attributes.order ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.attributes.order ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return (a.attributes.title ?? a.slug).localeCompare(b.attributes.title ?? b.slug);
}

/** Frontmatter → the grouped sidebar, ordered by {@link DOCS_GROUP_ORDER} then by `order`. */
export function buildDocsNav(files: readonly DocsContentFile[]): DocsNavGroup[] {
  const byGroup = new Map<string, DocsContentFile[]>();

  for (const file of files) {
    const heading = file.attributes.group?.trim() || UNGROUPED;
    const bucket = byGroup.get(heading);
    if (bucket) bucket.push(file);
    else byGroup.set(heading, [file]);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => compareGroups(a, b))
    .map(([heading, groupFiles]) => ({
      heading,
      links: [...groupFiles].sort(compareLinks).map(toLink)
    }));
}

/** The nav flattened into reading order — what prev/next walks. */
export function flattenDocsNav(groups: readonly DocsNavGroup[]): DocsNavLink[] {
  return groups.flatMap((group) => group.links);
}

/** The neighbours of `slug` in reading order. Both are absent for an unknown slug. */
export function findAdjacent(
  links: readonly DocsNavLink[],
  slug: string
): { prev?: DocsNavLink; next?: DocsNavLink } {
  const index = links.findIndex((link) => link.slug === slug);
  if (index === -1) return {};

  const prev = links[index - 1];
  const next = links[index + 1];
  return {
    ...(prev !== undefined && { prev }),
    ...(next !== undefined && { next })
  };
}
