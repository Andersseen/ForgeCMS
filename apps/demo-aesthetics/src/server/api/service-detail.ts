import type { ServiceDetailPayload } from '../../shared/site-content';
import { toServiceDetail, toServiceSummary, toTeamMember } from './mappers';
import type { DemoRuntime } from './runtime';

const AS_VISITOR = { overrideAccess: false, user: null } as const;

/**
 * The `/services/:slug` payload, or `null` when no published treatment has that slug.
 *
 * Three Local API reads, all as an anonymous visitor so drafts and access rules apply exactly as they
 * would over HTTP. Kept out of the route file so tests can call it without an h3 event.
 *
 * - `findOne` is the single-document read by slug (spec 050), not `find({ limit: 1 }).docs[0]`.
 * - `containsValue` asks the database for "staff whose `specialties` include this service"
 *   (spec 050). It used to load the whole team and filter in JavaScript (finding 10).
 */
export async function loadServiceDetail(
  runtime: DemoRuntime,
  slug: string
): Promise<ServiceDetailPayload | null> {
  const record = await runtime.findOne({
    collection: 'services',
    where: { slug },
    depth: 1,
    ...AS_VISITOR
  });
  if (!record) return null;

  const service = toServiceDetail(record);
  const categoryId = service.category?.id;

  const [related, specialists] = await Promise.all([
    categoryId
      ? runtime.find({
          collection: 'services',
          where: { category: categoryId, id: { ne: service.id } },
          sort: 'order',
          order: 'asc',
          limit: 3,
          depth: 1,
          ...AS_VISITOR
        })
      : null,
    runtime.find({
      collection: 'staff',
      where: { active: true, specialties: { containsValue: service.id } },
      sort: 'order',
      order: 'asc',
      limit: 20,
      // The page shows each specialist's photo, an upload: without population it was an id, so no
      // photo ever rendered.
      depth: 1,
      ...AS_VISITOR
    })
  ]);

  return {
    service,
    relatedServices: related?.docs.map(toServiceSummary) ?? [],
    specialists: specialists.docs.map(toTeamMember)
  };
}
