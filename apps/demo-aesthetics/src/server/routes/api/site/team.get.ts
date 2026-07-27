import { defineEventHandler } from 'h3';
import { getServerRuntime } from '../../../api/runtime';
import { toTeamMember } from '../../../api/mappers';
import type { TeamMember } from '../../../../shared/site-content';

/** The clinic team, with their treatment specialties resolved to names. */
export default defineEventHandler(async (event): Promise<{ data: TeamMember[] }> => {
  const runtime = await getServerRuntime(event.context.cloudflare?.env);

  const staff = await runtime.find({
    collection: 'staff',
    where: { active: true },
    sort: 'order',
    order: 'asc',
    limit: 20,
    depth: 1,
    overrideAccess: false,
    user: null
  });

  return { data: staff.docs.map(toTeamMember) };
});
