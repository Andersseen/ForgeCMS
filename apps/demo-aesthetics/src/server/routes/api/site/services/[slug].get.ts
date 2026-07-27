import { createError, defineEventHandler, getRouterParam } from 'h3';
import { getServerRuntime } from '../../../../api/runtime';
import { populateUploads } from '../../../../api/uploads';
import { toServiceDetail, toServiceSummary, toTeamMember } from '../../../../api/mappers';
import type { ServiceDetailPayload } from '../../../../../shared/site-content';

/** One treatment, its siblings in the same category, and the specialists who perform it. */
export default defineEventHandler(async (event): Promise<{ data: ServiceDetailPayload }> => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);
  const slug = getRouterParam(event, 'slug') ?? '';
  const asVisitor = { overrideAccess: false, user: null } as const;

  // FINDING 10: there is no `findBySlug`, and `findByID` is the only single-document operation, so
  // "the page at /services/:slug" is a list query with `limit: 1` in every app that has slugs.
  const found = await runtime.find({
    collection: 'services',
    where: { slug },
    limit: 1,
    depth: 1,
    ...asVisitor
  });
  const [record] = found.docs;
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Service not found' });
  }

  const [withImage] = await populateUploads(runtime, [record], ['image']);
  const service = toServiceDetail(withImage ?? record);

  const categoryId = service.category?.id;
  const [related, staff] = await Promise.all([
    categoryId
      ? runtime.find({
          collection: 'services',
          where: { category: categoryId },
          sort: 'order',
          order: 'asc',
          limit: 4,
          depth: 1,
          ...asVisitor
        })
      : Promise.resolve({ docs: [] as Awaited<ReturnType<typeof runtime.find>>['docs'] }),
    // FINDING 10 (second half): `where` cannot ask "documents whose many-relation contains this id"
    // — `contains` is a string operator — so the whole (small) team is loaded and filtered in JS.
    runtime.find({ collection: 'staff', where: { active: true }, limit: 20, ...asVisitor })
  ]);

  const specialistRecords = staff.docs.filter((member) => {
    const specialties = member.specialties;
    return Array.isArray(specialties) && specialties.includes(service.id);
  });
  const specialistsWithPhotos = await populateUploads(runtime, specialistRecords, ['photo']);
  const relatedWithImages = await populateUploads(
    runtime,
    related.docs.filter((doc) => String(doc.id) !== service.id),
    ['image']
  );

  return {
    data: {
      service,
      relatedServices: relatedWithImages.map(toServiceSummary),
      specialists: specialistsWithPhotos.map(toTeamMember)
    }
  };
});
