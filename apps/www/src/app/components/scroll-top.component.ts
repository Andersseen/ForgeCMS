import { ChangeDetectionStrategy, Component, DOCUMENT, inject, signal } from '@angular/core';
import {
  MoveAnimateDirective,
  MoveHoverDirective,
  MovePresenceDirective,
  MoveTapDirective
} from 'angular-movement';
import { LmnArrowUpIcon } from 'lumen-icons/arrow-up';

/** Pixels of upward travel that count as "scrolling up" (ignores trackpad jitter). */
const UP_DELTA = 6;

/**
 * A back-to-top button that only exists while the reader is past the first screen and moving down.
 * Scrolling back up (or returning to the top) removes it. `*movePresence` keeps the view in the DOM
 * until the exit animation finishes; `angular-movement` honours `prefers-reduced-motion` itself.
 */
@Component({
  selector: 'forge-cms-scroll-top',
  standalone: true,
  imports: [
    MovePresenceDirective,
    MoveAnimateDirective,
    MoveHoverDirective,
    MoveTapDirective,
    LmnArrowUpIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()' },
  template: `
    <ng-container *movePresence="visible()">
      <button
        type="button"
        class="forge-scroll-top"
        aria-label="Back to top"
        [moveInitial]="{ opacity: 0, y: 16, scale: 0.9 }"
        [moveAnimate]="{ opacity: 1, y: 0, scale: 1 }"
        [moveExit]="{ opacity: 0, y: 16, scale: 0.9 }"
        moveWhileHover="lift"
        moveWhileTap="press"
        (click)="toTop()"
      >
        <lmn-arrow-up [size]="20" />
      </button>
    </ng-container>
  `
})
export class ScrollTopComponent {
  private readonly document = inject(DOCUMENT);
  private lastY = 0;

  protected readonly visible = signal(false);

  protected onScroll(): void {
    const view = this.document.defaultView;
    if (!view) return;
    const y = view.scrollY;
    // "Past the hero": the first screen has scrolled out of view.
    const pastHero = y > view.innerHeight * 0.9;
    const delta = y - this.lastY;

    if (!pastHero) this.visible.set(false);
    else if (delta > 0) this.visible.set(true);
    else if (delta < -UP_DELTA) this.visible.set(false);

    this.lastY = y;
  }

  protected toTop(): void {
    const view = this.document.defaultView;
    const reduced =
      typeof view?.matchMedia === 'function' &&
      view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    view?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }
}
