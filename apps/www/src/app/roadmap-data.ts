import milestones from '../../../../docs/roadmap/v2/milestones.json';
import type { SiteMessageKey } from './i18n/i18n';

export const V2_MILESTONES = milestones;

export type V2MilestoneStatus = (typeof V2_MILESTONES)[number]['status'];

/**
 * The canonical milestones as homepage cards (spec 101): the inventory, order and status come from
 * `docs/roadmap/v2/milestones.json`; the visible title, summary and status label are catalog keys, so
 * every language reads the same milestones. A test pins the English catalog to the canonical text.
 */
export const ROADMAP_CARDS = V2_MILESTONES.map((milestone) => ({
  id: milestone.id,
  status: milestone.status,
  statusKey: `roadmap.status.${milestone.status}` as SiteMessageKey,
  titleKey: `roadmap.milestones.${milestone.id}.title` as SiteMessageKey,
  summaryKey: `roadmap.milestones.${milestone.id}.summary` as SiteMessageKey
}));
