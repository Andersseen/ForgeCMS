import { describe, expect, it } from 'vitest';
import { FORGE_CHANNELS, agentInstallCommand } from './forge-release';
import {
  activeStageIndex,
  agentAvailabilityNote,
  agentTerminal,
  analyticsPreview,
  analyticsRanges,
  bentoCards,
  formatChange,
  releaseSteps,
  storySnippets,
  storyStages,
  swapSnippets,
  swapStates
} from './showcase-data';

describe('story stages (spec 097)', () => {
  it('tells Schema → Runtime → Angular → Admin → Deploy, in that order', () => {
    expect(storyStages.map((stage) => stage.label)).toEqual([
      'Schema',
      'Runtime',
      'Angular',
      'Admin',
      'Deploy'
    ]);
    expect(storyStages.map((stage) => stage.index)).toEqual(['01', '02', '03', '04', '05']);
  });

  it('activates the last stage whose top crossed the reading line', () => {
    const line = 450;
    // Before the story: the first stage is active, never "none".
    expect(activeStageIndex([900, 1500, 2100, 2700, 3300], line)).toBe(0);
    expect(activeStageIndex([-200, 300, 900, 1500, 2100], line)).toBe(1);
    expect(activeStageIndex([-900, -400, 449, 1000, 1600], line)).toBe(2);
    // Exactly on the line counts as crossed.
    expect(activeStageIndex([-900, -400, 450, 1000, 1600], line)).toBe(2);
    // Past the end: the final stage stays active, so it is always reachable.
    expect(activeStageIndex([-3000, -2400, -1800, -1200, -600], line)).toBe(4);
  });

  it('is monotonic while scrolling down', () => {
    const tops = [600, 1200, 1800, 2400, 3000];
    let previous = 0;
    for (let scrolled = 0; scrolled <= 3200; scrolled += 40) {
      const index = activeStageIndex(
        tops.map((top) => top - scrolled),
        450
      );
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
    expect(previous).toBe(4);
  });

  it('quotes the real 1.0 API names and localizes only text and textarea', () => {
    expect(storySnippets.schema).toContain('defineCollection');
    expect(storySnippets.schema).toContain("locales: ['es', 'en']");
    expect(storySnippets.schema).toContain("defineField.upload({ collection: 'media' })");
    expect(storySnippets.localApi).toContain('runtime.find(');
    expect(storySnippets.localApi).toContain('overrideAccess: false');
    expect(storySnippets.angular).toContain('collectionResource');
    expect(storySnippets.angular).toContain('.docs');
    for (const snippet of [storySnippets.schema, swapSnippets.model]) {
      for (const line of snippet.split('\n').filter((l) => l.includes('localized: true')))
        expect(line).toMatch(/defineField\.(text|textarea)\(/);
    }
  });
});

describe('developer ↔ client swap', () => {
  it('has three states and swaps the leading column only for Publish', () => {
    expect(swapStates.map((state) => state.id)).toEqual(['model', 'build', 'publish']);
    expect(swapStates.filter((state) => state.lead === 'client').map((s) => s.id)).toEqual([
      'publish'
    ]);
  });

  it('never claims a page builder or a future server-component feature', () => {
    const copy = JSON.stringify([swapStates, swapSnippets, bentoCards]).toLowerCase();
    expect(copy).not.toMatch(/page builder|drag and drop|server component|strata/);
  });
});

describe('Agent Kit terminal', () => {
  it('leads with the spec 096 one-command init and stays read-only', () => {
    expect(agentTerminal[0]).toEqual({ kind: 'command', text: 'pnpm exec forge-cms-agent init' });
    expect(agentTerminal.some((row) => row.text.includes('8 ForgeCMS skills'))).toBe(true);
    const copy = JSON.stringify(agentTerminal).toLowerCase();
    // The MCP never writes, creates or publishes CMS content.
    expect(copy).not.toMatch(/forge_(create|update|write|publish|delete)/);
    expect(agentTerminal.at(-1)?.detail).toMatch(/reviewed by you/);
  });

  it('labels availability from registry truth only', () => {
    expect(agentAvailabilityNote().includes('not on npm yet')).toBe(!FORGE_CHANNELS.agentPublished);
    // The terminal never shows an install of the package itself.
    expect(JSON.stringify(agentTerminal)).not.toMatch(/pnpm add|npm install/);
    expect(agentInstallCommand() === null).toBe(!FORGE_CHANNELS.agentPublished);
  });
});

describe('Analytics preview', () => {
  it('covers exactly the four ranges with deterministic data', () => {
    expect(analyticsRanges).toEqual(['24h', '7d', '30d', '90d']);
    for (const range of analyticsRanges) {
      const data = analyticsPreview[range];
      expect(data.range).toBe(range);
      expect(data.timeline.every((v) => v >= 0 && v <= 1)).toBe(true);
      expect(data.topPages.length).toBeGreaterThan(0);
    }
    expect(analyticsPreview['7d'].pageviews).toBe(1284);
    expect(formatChange(18.4)).toBe('+18.4%');
    expect(formatChange(-3.2)).toBe('−3.2%');
  });

  it('only has metrics the Analytics vertical really has', () => {
    const keys = new Set(Object.values(analyticsPreview).flatMap((data) => Object.keys(data)));
    expect([...keys].sort()).toEqual(
      ['change', 'countries', 'pageviews', 'range', 'referrers', 'timeline', 'topPages'].sort()
    );
    const copy = JSON.stringify(analyticsPreview).toLowerCase();
    for (const absent of [
      'visitor',
      'session',
      'funnel',
      'event',
      'heatmap',
      'revenue',
      'conversion'
    ])
      expect(copy).not.toContain(absent);
  });
});

describe('release status', () => {
  it('never claims a released 1.0, and says "next" for an unpublished RC', () => {
    const steps = releaseSteps();
    expect(steps[0]).toEqual({ label: '1.0 candidate certified', state: 'done' });
    if (!FORGE_CHANNELS.rcPublished)
      expect(steps[1]).toEqual({ label: 'Public RC next', state: 'next' });
    expect(JSON.stringify(steps)).not.toMatch(/1\.0(\.0)? (is )?released/i);
    expect(steps.at(-1)?.state).not.toBe('done');
  });
});
