import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ROADMAP_MILESTONES, type MilestoneStatus } from '../landing-data';

const STATUS_LABELS: Record<MilestoneStatus, string> = {
  complete: 'Complete',
  'in-progress': 'In progress',
  next: 'Next',
  pending: 'Pending',
  planned: 'Planned'
};

/** The path to 1.0 as product checkpoints. Packet codes (M01…) live in docs/ROADMAP.md. */
@Component({
  selector: 'forge-cms-roadmap-section',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="roadmap" class="bg-foreground px-6 py-20 text-background md:px-8">
      <div class="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p class="text-sm font-semibold uppercase tracking-normal text-background/60">Roadmap</p>
          <h2 class="mt-4 text-3xl font-semibold md:text-5xl">What remains before 1.0.</h2>
          <p class="mt-5 text-lg leading-8 text-background/75">
            Each checkpoint is a guarantee, not a feature count. Roadmap checkpoints and npm
            versions are separate: the packages move by patch and minor releases as the work lands.
          </p>
          <a
            routerLink="/docs/schema-upgrades"
            class="mt-6 inline-block text-sm font-medium underline underline-offset-4"
            >How schema upgrades work today</a
          >
        </div>
        <ol class="space-y-3">
          @for (milestone of milestones; track milestone.version) {
            <li class="rounded-lg border border-background/20 bg-background/10 p-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="font-semibold">{{ milestone.version }} — {{ milestone.title }}</span>
                <span
                  class="rounded-full border border-background/30 px-2.5 py-0.5 text-xs font-medium"
                  >{{ labels[milestone.status] }}</span
                >
              </div>
              @if (milestone.steps; as steps) {
                <ul class="mt-3 space-y-1.5 text-sm text-background/75">
                  @for (step of steps; track step.title) {
                    <li class="flex items-center justify-between gap-3">
                      <span>{{ step.title }}</span>
                      <span class="text-xs">{{ labels[step.status] }}</span>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ol>
      </div>
    </section>
  `
})
export class RoadmapSectionComponent {
  protected readonly milestones = ROADMAP_MILESTONES;
  protected readonly labels = STATUS_LABELS;
}
