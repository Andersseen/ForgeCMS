import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  inject,
  signal,
  viewChild
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnChevronLeftIcon } from 'lumen-icons/chevron-left';
import { MoveAnimator } from 'angular-movement';
import { LmnChevronRightIcon } from 'lumen-icons/chevron-right';
import { V2_MILESTONES } from '../roadmap-data';

/** Soft, slightly underdamped spring: one clear overshoot, then rest. */
const SPRING = { stiffness: 220, damping: 15, mass: 1 };

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
          data-scroll-x
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
  private readonly animator = inject(MoveAnimator);
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  protected readonly milestones = V2_MILESTONES;
  protected readonly nextMilestone = V2_MILESTONES.find((m) => m.status === 'Next');
  protected readonly atStart = signal(true);
  protected readonly atEnd = signal(false);

  constructor() {
    afterNextRender(() => this.syncEdges());
  }

  /**
   * Moves the track exactly one card. The scroll position jumps instantly (so snap and keyboard
   * scrolling stay native) and every card then springs from where it visibly was to its new place,
   * which gives the step a small bounce instead of a long glide. Reduced motion skips the spring.
   */
  protected page(direction: -1 | 1): void {
    const track = this.track().nativeElement;
    const cards = Array.from(track.children) as HTMLElement[];
    const first = cards[0];
    if (!first) return;

    const step = cards[1] ? cards[1].offsetLeft - first.offsetLeft : first.offsetWidth;
    const before = track.scrollLeft;
    const max = track.scrollWidth - track.clientWidth;
    const target = Math.min(max, Math.max(0, (Math.round(before / step) + direction) * step));

    // Snap areas follow the cards' transforms, so mandatory snap would re-resolve the jump to another
    // card while they spring. Suspend it until the motion settles.
    track.style.scrollSnapType = 'none';
    track.scrollTo({ left: target, behavior: 'instant' });
    const shift = track.scrollLeft - before;
    if (Math.abs(shift) < 1) {
      track.style.scrollSnapType = '';
      return;
    }

    const lead = Math.round(track.scrollLeft / step);
    const runs = cards.map(
      (card, index) =>
        this.animator.animate(
          card,
          { x: [shift, 0] },
          {
            spring: SPRING,
            delay: Math.min(Math.abs(index - lead), 4) * 28
          }
        )?.finished
    );
    this.syncEdges();
    void Promise.allSettled(runs).then(() => {
      track.style.scrollSnapType = '';
      this.syncEdges();
    });
  }

  protected syncEdges(): void {
    const track = this.track().nativeElement;
    this.atStart.set(track.scrollLeft <= 4);
    this.atEnd.set(track.scrollLeft + track.clientWidth >= track.scrollWidth - 4);
  }
}
