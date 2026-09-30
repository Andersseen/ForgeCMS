import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnCheckIcon } from 'lumen-icons/check';
import { ROADMAP_MILESTONES, type MilestoneStatus } from '../landing-data';

const STATUS_LABELS: Record<MilestoneStatus, string> = {
  complete: 'Complete',
  'in-progress': 'In progress',
  next: 'Next',
  pending: 'Pending',
  planned: 'Planned'
};

@Component({
  selector: 'forge-cms-roadmap-section',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon, LmnCheckIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="roadmap" class="bg-[#0A0F1A] px-5 py-22 text-white md:px-8 md:py-28">
      <div class="mx-auto w-full max-w-7xl">
        <div class="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-18">
          <div>
            <p class="text-sm font-medium text-[#22D3EE]">Approaching 1.0 deliberately</p>
            <h2
              class="mt-5 max-w-[14ch] text-4xl font-semibold leading-[1.05] tracking-[-0.045em] md:text-5xl"
            >
              Finish the guarantees, then call it stable.
            </h2>
            <p class="mt-5 max-w-[48ch] leading-7 text-white/65">
              ForgeCMS is not racing toward a feature count. Each checkpoint turns an existing
              capability into something an Angular team can rely on.
            </p>
            <a
              voltButton
              variant="outline"
              class="mt-8 border-white/25 bg-white/5 text-white hover:bg-white/10"
              routerLink="/docs/schema-upgrades"
            >
              How schema upgrades work
              <lmn-arrow-right [size]="16" />
            </a>
          </div>

          <ol class="border-t border-white/15">
            @for (milestone of milestones; track milestone.version) {
              <li class="grid gap-4 border-b border-white/15 py-6 sm:grid-cols-[7rem_1fr_auto]">
                <span class="font-mono text-sm text-white/45">{{ milestone.version }}</span>
                <div>
                  <h3 class="font-semibold">{{ milestone.title }}</h3>
                  @if (milestone.steps; as steps) {
                    <ul class="mt-3 space-y-2 text-sm text-white/60">
                      @for (step of steps; track step.title) {
                        <li class="flex items-center gap-2">
                          @if (step.status === 'complete') {
                            <lmn-check tone="success" [size]="16" />
                          } @else {
                            <span class="size-1.5 rounded-full bg-[#8B5CF6]"></span>
                          }
                          <span>{{ step.title }}</span>
                        </li>
                      }
                    </ul>
                  }
                </div>
                <span
                  class="h-fit rounded-full border border-white/20 px-3 py-1 text-xs text-white/70"
                >
                  {{ labels[milestone.status] }}
                </span>
              </li>
            }
          </ol>
        </div>
      </div>
    </section>
  `
})
export class RoadmapSectionComponent {
  protected readonly milestones = ROADMAP_MILESTONES.filter((milestone) =>
    ['0.6', '0.7', '0.8'].includes(milestone.version)
  );
  protected readonly labels = STATUS_LABELS;
}
