import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { V2_MILESTONES } from '../roadmap-data';

/**
 * A compact public summary of the canonical V2 milestone inventory. Detailed acceptance criteria and
 * evidence live in the roadmap documentation.
 */
@Component({
  selector: 'forge-cms-roadmap-section',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="roadmap" class="forge-roadmap" aria-labelledby="roadmap-title">
      <div class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div>
          <p class="forge-section-mark">ForgeCMS 1.0 → 2.0</p>
          <h2 id="roadmap-title" class="forge-section-title mt-5">
            A shipped foundation. A clear next direction.
          </h2>
          <p class="mt-5 max-w-[56ch] leading-7 text-muted-foreground">
            ForgeCMS 1.0.0 is shipped. The V2 roadmap focuses on stronger editorial workflows,
            developer experience, and production operations.
          </p>
          <p class="mt-3 max-w-[56ch] text-sm leading-6 text-muted-foreground">
            These are product milestones, not npm versions or delivery dates. V2 features are
            roadmap intentions until shipped and documented.
          </p>
        </div>

        <ol class="forge-roadmap-cards" aria-label="ForgeCMS 2.0 milestones">
          @for (milestone of milestones; track milestone.id) {
            <li class="forge-milestone" [attr.data-status]="milestone.status">
              <div class="forge-milestone-top">
                <span class="forge-milestone-version">{{ milestone.id }}</span>
                <span class="forge-milestone-status">{{ milestone.status }}</span>
              </div>
              <h3>{{ milestone.title }}</h3>
              <p>{{ milestone.summary }}</p>
            </li>
          }
        </ol>

        <a voltButton variant="outline" class="mt-10" routerLink="/docs/roadmap">
          Read the full roadmap
          <lmn-arrow-right [size]="16" />
        </a>
      </div>
    </section>
  `
})
export class RoadmapSectionComponent {
  protected readonly milestones = V2_MILESTONES;
}
