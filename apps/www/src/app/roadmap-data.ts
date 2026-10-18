import milestones from '../../../../docs/roadmap/v2/milestones.json';

export const V2_MILESTONES = milestones;

export type V2MilestoneStatus = (typeof V2_MILESTONES)[number]['status'];
