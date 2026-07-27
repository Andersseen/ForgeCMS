import { definePublicSiteRoute } from '../../../api/public-route';
import { toTeamMember } from '../../../api/mappers';
import type { TeamMember } from '../../../../shared/site-content';

/** The clinic team, with their treatment specialties resolved to names. */
export default definePublicSiteRoute(async (runtime): Promise<TeamMember[]> => {
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

  return staff.docs.map(toTeamMember);
});
