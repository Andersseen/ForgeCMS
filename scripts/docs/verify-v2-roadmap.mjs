import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Keep the contract, public Markdown, and website's data source aligned with one canonical inventory. */
export function verifyV2Roadmap(root) {
  const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
  const inventory = JSON.parse(read('docs', 'roadmap', 'v2', 'milestones.json'));
  const contract = read('docs', 'roadmap', 'v2', 'MILESTONES.md');
  const publicPage = read('apps', 'www', 'src', 'content', 'docs', 'roadmap.md');
  const homepage = read('apps', 'www', 'src', 'app', 'roadmap-data.ts');
  const failures = [];
  const expectedIds = Array.from(
    { length: 10 },
    (_, index) => `V2-${String(index + 1).padStart(2, '0')}`
  );

  if (!Array.isArray(inventory) || inventory.length !== 10) {
    failures.push('canonical inventory must contain exactly ten milestones');
    return failures;
  }

  const ids = inventory.map((milestone) => milestone.id);
  if (new Set(ids).size !== 10) failures.push('canonical milestone IDs must be unique');
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds))
    failures.push('canonical IDs must remain V2-01 through V2-10 in order');
  if (!homepage.includes('../../../../docs/roadmap/v2/milestones.json')) {
    failures.push('homepage must consume the canonical milestone inventory');
  }

  for (const milestone of inventory) {
    if (!['Shipped', 'In Progress', 'Next', 'Planned'].includes(milestone.status)) {
      failures.push(`${milestone.id} uses an unknown status: ${milestone.status}`);
    }
    const heading = `## ${milestone.id} — ${milestone.title}`;
    if (!contract.includes(heading))
      failures.push(`internal milestone contract is missing ${milestone.id} / ${milestone.title}`);
    const sectionStart = contract.indexOf(heading);
    const nextSection = contract.indexOf('\n## ', sectionStart + heading.length);
    const section = contract.slice(sectionStart, nextSection === -1 ? undefined : nextSection);
    if (!section.includes(`- **Status:** **${milestone.status}`)) {
      failures.push(`internal roadmap status differs for ${milestone.id}`);
    }
    const publicRow = publicPage
      .split('\n')
      .find((line) => line.startsWith(`| ${milestone.id} `))
      ?.split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (
      publicRow?.[0] !== milestone.id ||
      publicRow[1] !== milestone.title ||
      publicRow[2] !== `**${milestone.status}**` ||
      publicRow[3] !== milestone.summary
    ) {
      failures.push(`public roadmap summary/status/title differs for ${milestone.id}`);
    }
  }

  if (
    inventory.filter(({ status }) => status === 'Next').length !== 1 ||
    inventory[0].status !== 'Next'
  ) {
    failures.push('V2-01 must be the only Next milestone until evidence changes');
  }
  return failures;
}
