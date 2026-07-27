/**
 * `DatabaseRecord` → the typed payloads in `src/shared/site-content.ts`.
 *
 * Every function here is boilerplate the CMS could generate: the collection definition already
 * knows each field's type, but `find`/`findByID` hand back `Record<string, unknown>` (see finding 8).
 * Keeping the casting in one file at least stops it leaking into the pages.
 */
import type { DatabaseRecord } from '@forge-cms/db';
import type {
  CategoryRef,
  MediaRef,
  OpeningHours,
  PageBlock,
  PageContent,
  PostDetail,
  PostSummary,
  Promotion,
  RichTextParagraph,
  ServiceAftercare,
  ServiceBenefit,
  ServiceDetail,
  ServiceFaq,
  ServiceSummary,
  SiteSettings,
  TeamMember,
  Testimonial
} from '../../shared/site-content';

type Rec = Record<string, unknown>;

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function obj(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : null;
}

function rows(value: unknown): Rec[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Rec => typeof row === 'object' && row !== null);
}

/** Flattens a richtext tree to paragraphs of plain text — there is no renderer for it (finding 7). */
export function toParagraphs(value: unknown): RichTextParagraph[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((node) => ({ text: collectText(node).trim() }))
    .filter((paragraph) => paragraph.text.length > 0);
}

function collectText(node: unknown): string {
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  const record = obj(node);
  if (!record) return '';
  const own = str(record.text);
  const children = 'children' in record ? collectText(record.children) : '';
  return [own, children].filter(Boolean).join(' ');
}

/**
 * A relation/upload field is either a bare id string or — with `depth: 1` — the populated record.
 * Callers cannot know which without checking, so this narrows both cases.
 */
export function toMedia(value: unknown): MediaRef | null {
  const record = obj(value);
  if (!record) return null;
  return { id: str(record.id), url: str(record.url), alt: str(record.alt) };
}

export function toCategory(value: unknown): CategoryRef | null {
  const record = obj(value);
  if (!record) return null;
  return {
    id: str(record.id),
    name: str(record.name),
    slug: str(record.slug),
    tagline: str(record.tagline)
  };
}

export function toServiceSummary(record: DatabaseRecord): ServiceSummary {
  return {
    id: str(record.id),
    name: str(record.name),
    slug: str(record.slug),
    summary: str(record.summary),
    price: num(record.price) ?? 0,
    priceNote: str(record.priceNote),
    durationMinutes: num(record.durationMinutes) ?? 0,
    featured: bool(record.featured),
    image: toMedia(record.image),
    category: toCategory(record.category)
  };
}

export function toServiceDetail(record: DatabaseRecord): ServiceDetail {
  const aftercare = obj(record.aftercare);
  return {
    ...toServiceSummary(record),
    description: toParagraphs(record.description),
    benefits: rows(record.benefits).map<ServiceBenefit>((row) => ({
      title: str(row.title),
      detail: str(row.detail)
    })),
    faqs: rows(record.faqs).map<ServiceFaq>((row) => ({
      question: str(row.question),
      answer: str(row.answer)
    })),
    aftercare: aftercare
      ? ({
          downtimeDays: num(aftercare.downtimeDays),
          instructions: str(aftercare.instructions),
          sessionsRecommended: num(aftercare.sessionsRecommended)
        } satisfies ServiceAftercare)
      : null
  };
}

export function toTeamMember(record: DatabaseRecord): TeamMember {
  const socials = obj(record.socials);
  const specialties = Array.isArray(record.specialties) ? record.specialties : [];
  return {
    id: str(record.id),
    name: str(record.name),
    slug: str(record.slug),
    jobTitle: str(record.jobTitle),
    bio: str(record.bio),
    photo: toMedia(record.photo),
    credentials: rows(record.credentials).map((row) => ({
      title: str(row.title),
      issuer: str(row.issuer),
      year: num(row.year)
    })),
    // `depth: 1` populates single relations only for the fields it knows; a `many` relation comes
    // back populated too, so accept both an id list and a record list.
    specialties: specialties.map((entry) => str(obj(entry)?.name ?? entry)),
    socials: { instagram: str(socials?.instagram), linkedin: str(socials?.linkedin) }
  };
}

export function toTestimonial(record: DatabaseRecord): Testimonial {
  return {
    id: str(record.id),
    author: str(record.author),
    quote: str(record.quote),
    rating: num(record.rating) ?? 5,
    serviceName: str(obj(record.service)?.name)
  };
}

export function toPromotion(record: DatabaseRecord): Promotion {
  return {
    id: str(record.id),
    title: str(record.title),
    description: str(record.description),
    discountPercent: num(record.discountPercent),
    code: str(record.code),
    validUntil: str(record.validUntil)
  };
}

export function toPostSummary(record: DatabaseRecord): PostSummary {
  return {
    id: str(record.id),
    title: str(record.title),
    slug: str(record.slug),
    excerpt: str(record.excerpt),
    topic: str(record.topic),
    publishedAt: str(record.publishedAt),
    readingMinutes: num(record.readingMinutes) ?? 1,
    coverImage: toMedia(record.coverImage),
    authorName: str(obj(record.author)?.name)
  };
}

export function toPostDetail(record: DatabaseRecord): PostDetail {
  return { ...toPostSummary(record), body: toParagraphs(record.body) };
}

export function toPageContent(record: DatabaseRecord): PageContent {
  const seo = obj(record.seo);
  const sections = Array.isArray(record.sections) ? record.sections : [];
  return {
    title: str(record.title),
    seo: {
      metaTitle: str(seo?.metaTitle),
      metaDescription: str(seo?.metaDescription),
      noIndex: bool(seo?.noIndex)
    },
    sections: sections
      .filter((section): section is PageBlock => typeof obj(section)?.blockType === 'string')
      .map((section) => section)
  };
}

export function toSiteSettings(record: DatabaseRecord): SiteSettings {
  const address = obj(record.address);
  const socials = obj(record.socials);
  return {
    clinicName: str(record.clinicName),
    tagline: str(record.tagline),
    about: str(record.about),
    phone: str(record.phone),
    email: str(record.email),
    bookingEmail: str(record.bookingEmail),
    address: {
      street: str(address?.street),
      city: str(address?.city),
      postalCode: str(address?.postalCode),
      mapUrl: str(address?.mapUrl)
    },
    openingHours: rows(record.openingHours).map<OpeningHours>((row) => ({
      day: str(row.day),
      opens: str(row.opens),
      closes: str(row.closes),
      closed: bool(row.closed)
    })),
    socials: {
      instagram: str(socials?.instagram),
      facebook: str(socials?.facebook),
      tiktok: str(socials?.tiktok)
    }
  };
}
