import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  signal,
  viewChild
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnChevronLeftIcon } from 'lumen-icons/chevron-left';
import { LmnChevronRightIcon } from 'lumen-icons/chevron-right';
import { V2_MILESTONES } from '../roadmap-data';

/**
 * A compact public summary of the canonical V2 milestone inventory as a native horizontal scroller
 * (scroll-snap, swipe, keyboard arrows once focused). The previous/next buttons only call `scrollBy`;
 * every card stays in the DOM in reading order, so nothing depends on them. Detailed acceptance
 * criteria and evidence live in the roadmap documentation.
 */
@Component({
  selector: 'forge-cms-roadmap-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltNativeButton,
    LmnArrowRightIcon,
    LmnChevronLeftIcon,
    LmnChevronRightIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:resize)': 'syncEdges()' },
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

        <div class="forge-roadmap-controls">
          <p class="forge-roadmap-count">
            {{ milestones.length }} milestones · {{ nextMilestone?.id }} is next
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              voltButton
              variant="outline"
              size="icon"
              aria-label="Previous milestones"
              [disabled]="atStart()"
              (click)="page(-1)"
            >
              <lmn-chevron-left [size]="20" />
            </button>
            <button
              type="button"
              voltButton
              variant="outline"
              size="icon"
              aria-label="Next milestones"
              [disabled]="atEnd()"
              (click)="page(1)"
            >
              <lmn-chevron-right [size]="20" />
            </button>
          </div>
        </div>

        <ol
          #track
          class="forge-roadmap-track"
          tabindex="0"
          aria-label="ForgeCMS 2.0 milestones"
          (scroll)="syncEdges()"
        >
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
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  protected readonly milestones = V2_MILESTONES;
  protected readonly nextMilestone = V2_MILESTONES.find((m) => m.status === 'Next');
  protected readonly atStart = signal(true);
  protected readonly atEnd = signal(false);

  constructor() {
    afterNextRender(() => this.syncEdges());
  }

  /** Scroll by most of the visible width; the CSS `scroll-behavior` honours reduced motion. */
  protected page(direction: -1 | 1): void {
    const track = this.track().nativeElement;
    track.scrollBy({ left: direction * track.clientWidth * 0.8 });
  }

  protected syncEdges(): void {
    const track = this.track().nativeElement;
    this.atStart.set(track.scrollLeft <= 4);
    this.atEnd.set(track.scrollLeft + track.clientWidth >= track.scrollWidth - 4);
  }
}
