import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'forge-cms-roadmap-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="roadmap" class="bg-foreground px-6 py-20 text-background md:px-8">
      <div class="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[1fr_0.8fr] lg:items-center">
        <div>
          <p class="text-sm font-semibold uppercase tracking-normal text-background/60">Roadmap</p>
          <h2 class="mt-4 text-3xl font-semibold md:text-5xl">
            Build the CMS after the foundation is boring.
          </h2>
        </div>
        <div class="rounded-lg border border-background/20 bg-background/10 p-6">
          <p class="text-lg leading-8 text-background/75">
            Next steps: tighten the schema API, design adapter test suites, sketch CRUD route
            helpers, and evolve the admin package only when the core contracts are stable.
          </p>
        </div>
      </div>
    </section>
  `
})
export class RoadmapSectionComponent {}
