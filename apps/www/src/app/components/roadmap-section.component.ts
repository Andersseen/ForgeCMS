import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
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
import { LmnChevronRightIcon } from 'lumen-icons/chevron-right';
import { V2_MILESTONES } from '../roadmap-data';

/** Slightly underdamped spring: one soft overshoot between cards, then rest. */
const STIFFNESS = 190;
const DAMPING = 17;

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
          (pointerdown)="stop()"
          (keydown)="stop()"
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
  private readonly view = inject(DOCUMENT).defaultView;
  private frame = 0;
  private pendingTarget: number | null = null;
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  protected readonly milestones = V2_MILESTONES;
  protected readonly nextMilestone = V2_MILESTONES.find((m) => m.status === 'Next');
  protected readonly atStart = signal(true);
  protected readonly atEnd = signal(false);

  constructor() {
    afterNextRender(() => this.syncEdges());
    inject(DestroyRef).onDestroy(() => {
      // No spring ever runs on the server, where the prerender DOM has no animation frames.
      if (this.frame) this.view?.cancelAnimationFrame(this.frame);
    });
  }

  /**
   * Moves the track exactly one card with a spring that drives `scrollLeft` itself. Animating the
   * scroll position (rather than transforming the cards) keeps the scrollable area fixed, and the
   * browser clamps it at both ends, so the first and last card can never be pushed past their stop.
   * Rapid clicks chain from the pending target; reduced motion jumps straight there.
   */
  protected page(direction: -1 | 1): void {
    const track = this.track().nativeElement;
    const cards = Array.from(track.children) as HTMLElement[];
    const first = cards[0];
    if (!first) return;

    const step = cards[1] ? cards[1].offsetLeft - first.offsetLeft : first.offsetWidth;
    const max = track.scrollWidth - track.clientWidth;
    const from = this.pendingTarget ?? track.scrollLeft;
    const target = Math.min(max, Math.max(0, (Math.round(from / step) + direction) * step));
    this.springTo(track, target, max);
  }

  /** Cancels a running spring and gives the scroller back to native snapping. */
  protected stop(): void {
    if (!this.frame) return;
    this.view?.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pendingTarget = null;
    this.track().nativeElement.style.scrollSnapType = '';
  }

  private springTo(track: HTMLElement, target: number, max: number): void {
    const view = this.view;
    const reduced = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
    this.stop();

    if (!view || reduced) {
      track.scrollTo({ left: target, behavior: 'instant' });
      this.syncEdges();
      return;
    }

    // Mandatory snap would fight the in-between positions, so suspend it while the spring runs.
    track.style.scrollSnapType = 'none';
    this.pendingTarget = target;
    let position = track.scrollLeft;
    let velocity = 0;
    let last = view.performance.now();

    const tick = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      velocity += (-STIFFNESS * (position - target) - DAMPING * velocity) * dt;
      position += velocity * dt;
      if (position < 0 || position > max) {
        position = Math.min(max, Math.max(0, position));
        velocity = 0;
      }
      track.scrollTo({ left: position, behavior: 'instant' });

      if (Math.abs(position - target) < 0.4 && Math.abs(velocity) < 4) {
        track.scrollTo({ left: target, behavior: 'instant' });
        this.frame = 0;
        this.pendingTarget = null;
        track.style.scrollSnapType = '';
        this.syncEdges();
        return;
      }
      this.frame = view.requestAnimationFrame(tick);
    };
    this.frame = view.requestAnimationFrame(tick);
  }

  protected syncEdges(): void {
    const track = this.track().nativeElement;
    this.atStart.set(track.scrollLeft <= 4);
    this.atEnd.set(track.scrollLeft + track.clientWidth >= track.scrollWidth - 4);
  }
}
