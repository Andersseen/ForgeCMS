/**
 * The content model of Lumea Aesthetics — a fictional skin & body clinic.
 *
 * This is deliberately a *business* content model, not a tour of CMS features: the shape is what a
 * clinic actually needs (a treatment menu with prices, a team, a booking inbox, seasonal offers, a
 * journal). Where ForgeCMS made that awkward, the workaround is marked `FINDING n` and written up in
 * docs/DEMO-FINDINGS.md.
 */
import { defineBlock, defineCollection, defineField } from '@forge-cms/core';
import type { AccessArgs, CmsUser, FieldHookArgs } from '@forge-cms/core';
import { withAuthFields } from '@forge-cms/auth';

const STAFF_ROLES = ['admin', 'editor'];

function isStaff(user: CmsUser | null): boolean {
  return user !== null && typeof user.role === 'string' && STAFF_ROLES.includes(user.role);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Derives a slug from another field when the editor leaves it blank.
 *
 * FINDING 1: `defineField.slug({ autoGenerate: true, sourceField: 'name' })` exists in the field
 * options but nothing in the runtime reads it, so every collection re-implements this hook.
 */
function slugFrom(sourceField: string) {
  return ({ value, data }: FieldHookArgs): unknown => {
    if (typeof value === 'string' && value.length > 0) return slugify(value);
    const source = data[sourceField];
    return typeof source === 'string' ? slugify(source) : value;
  };
}

// --- Reference data ----------------------------------------------------------------------------

export const serviceCategories = defineCollection({
  slug: 'service_categories',
  fields: {
    name: defineField.text({ required: true }),
    slug: defineField.slug({
      required: true,
      unique: true,
      hooks: { beforeValidate: [slugFrom('name')] }
    }),
    tagline: defineField.text(),
    description: defineField.textarea(),
    order: defineField.number({ defaultValue: 0, index: true })
  }
});

// --- The treatment menu ------------------------------------------------------------------------

export const services = defineCollection({
  slug: 'services',
  drafts: true,
  fields: {
    name: defineField.text({ required: true }),
    slug: defineField.slug({
      required: true,
      unique: true,
      hooks: { beforeValidate: [slugFrom('name')] }
    }),
    category: defineField.relation({ collection: 'service_categories', index: true }),
    summary: defineField.textarea({ required: true, maxLength: 240 }),
    description: defineField.richtext(),
    durationMinutes: defineField.number({ required: true, min: 15, max: 300 }),
    price: defineField.number({ required: true, min: 0 }),
    priceNote: defineField.text({ label: 'Price note (e.g. "per session")' }),
    image: defineField.upload({ collection: 'media' }),
    featured: defineField.boolean({ defaultValue: false, index: true }),
    order: defineField.number({ defaultValue: 0 }),
    benefits: defineField.array({
      label: 'Benefits',
      maxRows: 6,
      fields: {
        title: defineField.text({ required: true }),
        detail: defineField.textarea()
      }
    }),
    faqs: defineField.array({
      label: 'FAQs',
      maxRows: 8,
      fields: {
        question: defineField.text({ required: true }),
        answer: defineField.textarea({ required: true })
      }
    }),
    aftercare: defineField.group({
      label: 'Aftercare',
      fields: {
        downtimeDays: defineField.number({ min: 0, max: 30 }),
        instructions: defineField.textarea(),
        sessionsRecommended: defineField.number({ min: 1, max: 12 })
      }
    })
  },
  hooks: {
    beforeChange: [
      // Money is stored in whole cents nowhere — there is no currency field kind, so a `number`
      // rounded to 2 decimals is the best available (FINDING 3).
      ({ data }) => {
        if (typeof data.price !== 'number') return data;
        return { ...data, price: Math.round(data.price * 100) / 100 };
      }
    ]
  }
});

// --- People ------------------------------------------------------------------------------------

export const staff = defineCollection({
  slug: 'staff',
  fields: {
    name: defineField.text({ required: true }),
    slug: defineField.slug({
      required: true,
      unique: true,
      hooks: { beforeValidate: [slugFrom('name')] }
    }),
    jobTitle: defineField.text({ required: true }),
    bio: defineField.textarea(),
    photo: defineField.upload({ collection: 'media' }),
    specialties: defineField.relation({ collection: 'services', many: true }),
    credentials: defineField.array({
      label: 'Credentials',
      maxRows: 6,
      fields: {
        title: defineField.text({ required: true }),
        issuer: defineField.text(),
        year: defineField.number({ min: 1970, max: 2100 })
      }
    }),
    socials: defineField.group({
      label: 'Social profiles',
      fields: {
        instagram: defineField.text(),
        linkedin: defineField.text()
      }
    }),
    order: defineField.number({ defaultValue: 0 }),
    active: defineField.boolean({ defaultValue: true, index: true })
  }
});

// --- Social proof --------------------------------------------------------------------------------

export const testimonials = defineCollection({
  slug: 'testimonials',
  drafts: true,
  fields: {
    author: defineField.text({ required: true }),
    quote: defineField.textarea({ required: true, maxLength: 400 }),
    rating: defineField.number({ required: true, min: 1, max: 5 }),
    service: defineField.relation({ collection: 'services' }),
    visitedAt: defineField.date()
  }
});

// --- The booking inbox ---------------------------------------------------------------------------

const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

export const bookings = defineCollection({
  slug: 'bookings',
  fields: {
    name: defineField.text({ required: true }),
    email: defineField.email({ required: true, index: true }),
    phone: defineField.text(),
    service: defineField.relation({ collection: 'services', index: true }),
    preferredDate: defineField.date({ required: true, withTime: true }),
    notes: defineField.textarea({ maxLength: 600 }),
    status: defineField.select({
      options: BOOKING_STATUSES,
      defaultValue: 'pending',
      index: true,
      // Only staff may set a status directly; a visitor's create is normalised by the hook below.
      access: { write: STAFF_ROLES }
    }),
    // Internal triage notes must never reach a public read, even by accident.
    internalNotes: defineField.textarea({ access: { read: STAFF_ROLES, write: STAFF_ROLES } }),
    source: defineField.text({ defaultValue: 'website' })
  },
  access: {
    // A visitor with no account must be able to request an appointment.
    create: () => true,
    // Staff see the whole inbox; a signed-in client sees only their own requests; anonymous sees
    // nothing. The returned object is a row-level query constraint (spec 020).
    read: ({ user }: AccessArgs) => {
      if (isStaff(user)) return true;
      if (user?.email) return { email: { eq: user.email } };
      return false;
    },
    update: STAFF_ROLES,
    delete: ['admin']
  },
  hooks: {
    beforeValidate: [
      ({ data }) => ({
        ...data,
        ...(typeof data.email === 'string' && { email: data.email.trim().toLowerCase() }),
        ...(typeof data.phone === 'string' && { phone: data.phone.replace(/\s+/g, ' ').trim() })
      })
    ],
    beforeChange: [
      // A public POST must not be able to walk in already-confirmed. Field-level write access
      // rejects the request outright when a field is set, which is too harsh for a form that may
      // post a default; forcing the value is the friendlier equivalent.
      ({ data, operation, user }) => {
        if (operation !== 'create' || isStaff(user ?? null)) return data;
        return { ...data, status: 'pending', source: data.source ?? 'website' };
      }
    ],
    afterChange: [
      // FINDING 6: there is no email adapter (roadmap 029), so the one side effect every booking
      // form in the world needs — telling the clinic a booking arrived — can only be logged.
      ({ operation, doc }) => {
        if (operation !== 'create') return;
        console.info('[bookings] new request', { id: doc.id, email: doc.email });
      }
    ]
  }
});

// --- Seasonal offers -----------------------------------------------------------------------------

export const promotions = defineCollection({
  slug: 'promotions',
  fields: {
    title: defineField.text({ required: true }),
    description: defineField.textarea({ required: true }),
    discountPercent: defineField.number({ min: 1, max: 90 }),
    code: defineField.text(),
    services: defineField.relation({ collection: 'services', many: true }),
    validFrom: defineField.date(),
    validUntil: defineField.date(),
    active: defineField.boolean({ defaultValue: false, index: true })
  },
  access: {
    // Anonymous visitors only ever see live offers; staff see the drafts of next month's campaign
    // too. Expressed as a query constraint so it also narrows `totalDocs`.
    read: ({ user }: AccessArgs) => (isStaff(user) ? true : { active: { eq: true } })
  }
});

// --- The journal ---------------------------------------------------------------------------------

const WORDS_PER_MINUTE = 200;

/** Counts words in a richtext tree so the reading time is derived, never typed by hand. */
function countWords(node: unknown): number {
  if (Array.isArray(node))
    return node.reduce<number>((total, child) => total + countWords(child), 0);
  if (typeof node !== 'object' || node === null) return 0;
  const record = node as Record<string, unknown>;
  const own =
    typeof record.text === 'string' ? record.text.trim().split(/\s+/).filter(Boolean).length : 0;
  return own + countWords(record.children);
}

export const posts = defineCollection({
  slug: 'posts',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({
      required: true,
      unique: true,
      hooks: { beforeValidate: [slugFrom('title')] }
    }),
    excerpt: defineField.textarea({ required: true, maxLength: 280 }),
    body: defineField.richtext({ required: true }),
    coverImage: defineField.upload({ collection: 'media' }),
    author: defineField.relation({ collection: 'staff' }),
    topic: defineField.select({ options: ['skin', 'body', 'wellness', 'clinic news'] }),
    publishedAt: defineField.date({ index: true }),
    readingMinutes: defineField.number({
      label: 'Reading time (derived)',
      hooks: {
        beforeChange: [
          ({ data }) => Math.max(1, Math.round(countWords(data.body) / WORDS_PER_MINUTE))
        ]
      }
    })
  }
});

// --- Files ----------------------------------------------------------------------------------------

/**
 * Rewrites the URL the runtime derives from the storage adapter into one this app actually serves.
 *
 * FINDING 21: `InMemoryStorageAdapter.getPublicUrl` returns `https://forge.test/storage/<key>` — a
 * domain that does not exist — and no package serves stored bytes over HTTP, so uploads render as
 * broken images until the app adds both this hook and `routes/api/media/[...key].get.ts`.
 */
const STORAGE_URL_PREFIX = 'https://forge.test/storage/';

function serveThroughThisApp({ value }: FieldHookArgs): unknown {
  if (typeof value !== 'string' || !value.startsWith(STORAGE_URL_PREFIX)) return value;
  return `/api/media/${value.slice(STORAGE_URL_PREFIX.length)}`;
}

export const media = defineCollection({
  slug: 'media',
  upload: true,
  fields: {
    filename: defineField.text({ required: true }),
    alt: defineField.text(),
    url: defineField.text({ hooks: { beforeChange: [serveThroughThisApp] } }),
    contentType: defineField.text(),
    filesize: defineField.number(),
    credit: defineField.text()
  }
});

// --- Page builder ------------------------------------------------------------------------------------

export const pages = defineCollection({
  slug: 'pages',
  drafts: true,
  fields: {
    title: defineField.text({ required: true }),
    slug: defineField.slug({
      required: true,
      unique: true,
      hooks: { beforeValidate: [slugFrom('title')] }
    }),
    seo: defineField.group({
      label: 'SEO',
      fields: {
        metaTitle: defineField.text(),
        metaDescription: defineField.textarea({ maxLength: 180 }),
        noIndex: defineField.boolean({ defaultValue: false })
      }
    }),
    sections: defineField.blocks({
      label: 'Sections',
      blocks: [
        defineBlock({
          slug: 'hero',
          label: 'Hero',
          fields: {
            eyebrow: defineField.text(),
            heading: defineField.text({ required: true }),
            subheading: defineField.textarea(),
            primaryCtaLabel: defineField.text(),
            primaryCtaHref: defineField.text(),
            secondaryCtaLabel: defineField.text(),
            secondaryCtaHref: defineField.text()
          }
        }),
        defineBlock({
          slug: 'stat_band',
          label: 'Stat band',
          fields: {
            stats: defineField.array({
              maxRows: 4,
              fields: {
                value: defineField.text({ required: true }),
                label: defineField.text({ required: true })
              }
            })
          }
        }),
        defineBlock({
          slug: 'featured_services',
          label: 'Featured treatments',
          fields: {
            heading: defineField.text({ required: true }),
            intro: defineField.textarea(),
            limit: defineField.number({ min: 1, max: 6, defaultValue: 3 })
          }
        }),
        defineBlock({
          slug: 'rich_text',
          label: 'Rich text',
          fields: {
            heading: defineField.text(),
            body: defineField.textarea({ required: true }),
            align: defineField.select({ options: ['left', 'center'], defaultValue: 'left' })
          }
        }),
        defineBlock({
          slug: 'testimonials',
          label: 'Testimonials',
          fields: {
            heading: defineField.text({ required: true }),
            limit: defineField.number({ min: 1, max: 6, defaultValue: 3 })
          }
        }),
        defineBlock({
          slug: 'cta',
          label: 'Call to action',
          fields: {
            heading: defineField.text({ required: true }),
            body: defineField.textarea(),
            ctaLabel: defineField.text({ required: true }),
            ctaHref: defineField.text({ required: true })
          }
        })
      ]
    })
  }
});

// --- The "global" that isn't -----------------------------------------------------------------------

/**
 * FINDING 4: ForgeCMS has no globals (roadmap 023), so site-wide settings are a collection that is
 * expected to hold exactly one row. Nothing enforces that — `POST /api/v1/site_settings` will
 * happily create a second one, and every read has to pick `docs[0]`.
 */
export const siteSettings = defineCollection({
  slug: 'site_settings',
  fields: {
    clinicName: defineField.text({ required: true }),
    tagline: defineField.text(),
    about: defineField.textarea(),
    phone: defineField.text(),
    email: defineField.email(),
    bookingEmail: defineField.email(),
    address: defineField.group({
      label: 'Address',
      fields: {
        street: defineField.text(),
        city: defineField.text(),
        postalCode: defineField.text(),
        mapUrl: defineField.text()
      }
    }),
    openingHours: defineField.array({
      label: 'Opening hours',
      maxRows: 7,
      fields: {
        day: defineField.text({ required: true }),
        opens: defineField.text(),
        closes: defineField.text(),
        closed: defineField.boolean({ defaultValue: false })
      }
    }),
    socials: defineField.group({
      label: 'Socials',
      fields: {
        instagram: defineField.text(),
        facebook: defineField.text(),
        tiktok: defineField.text()
      }
    })
  }
});

// --- Auth ------------------------------------------------------------------------------------------

export const users = withAuthFields(
  defineCollection({
    slug: 'users',
    fields: {
      email: defineField.email({ required: true }),
      name: defineField.text(),
      role: defineField.select({ options: ['admin', 'editor', 'viewer'] }),
      jobTitle: defineField.text(),
      status: defineField.select({ options: ['active', 'inactive'], defaultValue: 'active' })
    }
  })
);

export const collections = [
  serviceCategories,
  services,
  staff,
  testimonials,
  bookings,
  promotions,
  posts,
  media,
  pages,
  siteSettings,
  users
];
