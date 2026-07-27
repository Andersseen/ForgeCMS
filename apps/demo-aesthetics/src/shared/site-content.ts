/**
 * The shapes `/api/site/*` returns.
 *
 * FINDING 8: these are written by hand. `CollectionData<typeof services>` already infers the record
 * type from the collection definition, but the Local API returns `DatabaseRecord`
 * (`Record<string, unknown>`), so the inference stops at the server boundary and every payload has
 * to be re-declared and cast. Roadmap 038 is exactly this gap.
 */

export interface MediaRef {
  id: string;
  url: string;
  alt: string;
}

export interface CategoryRef {
  id: string;
  name: string;
  slug: string;
  tagline: string;
}

export interface ServiceSummary {
  id: string;
  name: string;
  slug: string;
  summary: string;
  price: number;
  priceNote: string;
  durationMinutes: number;
  featured: boolean;
  image: MediaRef | null;
  category: CategoryRef | null;
}

export interface ServiceBenefit {
  title: string;
  detail: string;
}

export interface ServiceFaq {
  question: string;
  answer: string;
}

export interface ServiceAftercare {
  downtimeDays: number | null;
  instructions: string;
  sessionsRecommended: number | null;
}

export interface RichTextParagraph {
  text: string;
}

export interface ServiceDetail extends ServiceSummary {
  description: RichTextParagraph[];
  benefits: ServiceBenefit[];
  faqs: ServiceFaq[];
  aftercare: ServiceAftercare | null;
}

export interface TeamMember {
  id: string;
  name: string;
  slug: string;
  jobTitle: string;
  bio: string;
  photo: MediaRef | null;
  credentials: { title: string; issuer: string; year: number | null }[];
  specialties: string[];
  socials: { instagram: string; linkedin: string };
}

export interface Testimonial {
  id: string;
  author: string;
  quote: string;
  rating: number;
  serviceName: string;
}

export interface Promotion {
  id: string;
  title: string;
  description: string;
  discountPercent: number | null;
  code: string;
  validUntil: string;
}

export interface PostSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  topic: string;
  publishedAt: string;
  readingMinutes: number;
  coverImage: MediaRef | null;
  authorName: string;
}

export interface PostDetail extends PostSummary {
  body: RichTextParagraph[];
}

export interface OpeningHours {
  day: string;
  opens: string;
  closes: string;
  closed: boolean;
}

export interface SiteSettings {
  clinicName: string;
  tagline: string;
  about: string;
  phone: string;
  email: string;
  bookingEmail: string;
  address: { street: string; city: string; postalCode: string; mapUrl: string };
  openingHours: OpeningHours[];
  socials: { instagram: string; facebook: string; tiktok: string };
}

/** One row of the `blocks` field on a page. Narrow on `blockType` at the render site. */
export type PageBlock = Record<string, unknown> & { blockType: string };

export interface PageContent {
  title: string;
  seo: { metaTitle: string; metaDescription: string; noIndex: boolean };
  sections: PageBlock[];
}

export interface HomePayload {
  page: PageContent | null;
  featuredServices: ServiceSummary[];
  testimonials: Testimonial[];
  promotion: Promotion | null;
  settings: SiteSettings | null;
}

export interface ServicesPayload {
  services: ServiceSummary[];
  categories: CategoryRef[];
}

export interface ServiceDetailPayload {
  service: ServiceDetail;
  relatedServices: ServiceSummary[];
  specialists: TeamMember[];
}

export interface BookingRequest {
  name: string;
  email: string;
  phone?: string;
  service?: string;
  preferredDate: string;
  notes?: string;
}
