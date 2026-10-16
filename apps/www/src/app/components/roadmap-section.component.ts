import type { ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton, VoltProgress } from '@voltui/components';
import { MoveInViewDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnCheckIcon } from 'lumen-icons/check';
import { LmnChevronLeftIcon } from 'lumen-icons/chevron-left';
import { LmnChevronRightIcon } from 'lumen-icons/chevron-right';
import { FORGE_CHANNELS } from '../forge-release';
import { ROADMAP_MILESTONES, type MilestoneStatus } from '../landing-data';
import { releaseSteps } from '../showcase-data';

const STATUS_LABELS: Record<MilestoneStatus, string> = {
  complete: 'Complete',
  'in-progress': 'In progress',
  next: 'Next',
  pending: 'Pending',
  planned: 'Planned'
};

/**
 * Spec 097: the road to 1.0 as a track of milestone cards ending in the 1.0 destination card. The track
 * is a native horizontal scroller (scroll-snap, swipe, keyboard arrows once focused); the previous /
 * next buttons only call `scrollBy` on it, instantly under reduced motion. Every card is in the DOM and
 * in reading order, so nothing depends on the buttons or on animation.
 */
@Component({
  selector: 'forge-cms-roadmap-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltNativeButton,
    VoltProgress,
    MoveInViewDirective,
    MoveStaggerDirective,
    LmnArrowRightIcon,
    LmnCheckIcon,
    LmnChevronLeftIcon,
    LmnChevronRightIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="roadmap" class="forge-roadmap" aria-labelledby="roadmap-title">
      <div class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div>
          <p class="forge-section-mark">Approaching 1.0 deliberately</p>
          <h2 id="roadmap-title" class="forge-section-title mt-5">
            Built in the open. Getting stronger.
          </h2>
          <p class="mt-5 max-w-[56ch] leading-7 text-muted-foreground">
            {{ completeCount }} of {{ milestones.length }} milestones complete.
            {{ candidateCopy }} Until <code>1.0.0</code> ships, ForgeCMS is a 1.0 candidate, not a
            released 1.0.
          </p>
          <p class="mt-3 max-w-[56ch] text-sm leading-6 text-muted-foreground">
            Card numbers are product checkpoints, not npm versions. The checkpoint 0.12 shipped as
            npm 0.13.x, which is why the track goes from 0.12 straight to 1.0.
          </p>
        </div>

        <div class="forge-roadmap-controls">
          <volt-progress
            class="forge-roadmap-rail"
            aria-label="Milestones complete"
            [value]="completeCount"
            [max]="milestones.length"
            [valueLabel]="progressLabel"
          />
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
          aria-label="Roadmap milestones"
          moveStagger="70ms"
          (scroll)="syncEdges()"
        >
          @for (milestone of milestones; track milestone.version) {
            <li class="forge-milestone" [attr.data-status]="milestone.status" [moveInView]="reveal">
              <div class="forge-milestone-top">
                <span class="forge-milestone-version">{{ milestone.version }}</span>
                <span class="forge-milestone-status">
                  @if (milestone.status === 'complete') {
                    <lmn-check [size]="14" />
                  }
                  {{ labels[milestone.status] }}
                </span>
              </div>
              <h3>{{ milestone.title }}</h3>
              @if (milestone.npm; as npm) {
                <p class="forge-milestone-npm">npm {{ npm }}</p>
              }
              @if (milestone.steps; as steps) {
                <ul>
                  @for (step of steps; track step.title) {
                    <li>{{ step.title }}</li>
                  }
                </ul>
              }
              @if (milestone.version === '1.0') {
                <ol class="forge-release-steps" aria-label="Release status">
                  @for (step of steps; track step.label) {
                    <li [attr.data-state]="step.state">
                      @if (step.state === 'done') {
                        <lmn-check tone="success" [size]="16" />
                      } @else {
                        <span class="forge-release-dot" aria-hidden="true"></span>
                      }
                      <span>{{ step.label }}</span>
                      @if (step.state === 'next') {
                        <span class="forge-release-next">Next</span>
                      }
                    </li>
                  }
                </ol>
              }
            </li>
          }
        </ol>

        <a voltButton variant="outline" class="mt-10" routerLink="/docs/schema-upgrades">
          How schema upgrades work
          <lmn-arrow-right [size]="16" />
        </a>
      </div>
    </section>
  `
})
export class RoadmapSectionComponent {
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  /** The whole journey, 0.1 → 1.0. */
  protected readonly milestones = ROADMAP_MILESTONES;
  protected readonly completeCount = this.milestones.filter((m) => m.status === 'complete').length;
  protected readonly candidateCopy = FORGE_CHANNELS.rcPublished
    ? 'The 1.0 release candidate is published for validation.'
    : 'The 1.0 release candidate is prepared and certified; publication and real-consumer validation come next.';
  protected readonly labels = STATUS_LABELS;
  protected readonly steps = releaseSteps();
  protected readonly reveal = { opacity: [0, 1], y: [20, 0], scale: [0.98, 1] };

  protected readonly progressLabel = (value: number, max: number): string =>
    `${value} of ${max} milestones complete`;

  protected readonly atStart = signal(true);
  protected readonly atEnd = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const view = this.track().nativeElement.ownerDocument.defaultView;
      this.syncEdges();
      view?.addEventListener('resize', this.#onResize, { passive: true });
      destroyRef.onDestroy(() => view?.removeEventListener('resize', this.#onResize));
    });
  }

  readonly #onResize = (): void => this.syncEdges();

  /** Scroll the track by most of its visible width; instant when the reader prefers reduced motion. */
  protected page(direction: -1 | 1): void {
    const track = this.track().nativeElement;
    const reduced = track.ownerDocument.defaultView?.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    track.scrollBy({
      left: direction * track.clientWidth * 0.8,
      behavior: reduced ? 'auto' : 'smooth'
    });
  }

  protected syncEdges(): void {
    const track = this.track().nativeElement;
    this.atStart.set(track.scrollLeft <= 4);
    this.atEnd.set(track.scrollLeft + track.clientWidth >= track.scrollWidth - 4);
  }
}
