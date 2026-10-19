import { ChangeDetectionStrategy, Component, DOCUMENT, inject, signal } from '@angular/core';
import {
  MoveAnimateDirective,
  MoveHoverDirective,
  MovePresenceDirective,
  MoveTapDirective
} from 'angular-movement';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowUpIcon } from 'lumen-icons/arrow-up';

/** Upward travel from the last downward peak that counts as "scrolling up" (ignores jitter). */
const UP_TRAVEL = 24;

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
    VoltNativeButton,
    LmnArrowUpIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()' },
  template: `
    <ng-container *movePresence="visible()">
      <button
        type="button"
        voltButton
        variant="outline"
        size="icon"
        class="forge-scroll-top"
        aria-label="Back to top"
        [moveInitial]="{ opacity: 0, y: 16, scale: 0.92 }"
        [moveAnimate]="{ opacity: 1, y: 0, scale: 1 }"
        [moveExit]="{ opacity: 0, y: 10, scale: 0.96 }"
        moveDuration="420"
        moveEasing="cubic-bezier(0.22, 1, 0.36, 1)"
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
  /** Highest scroll position reached since the reader last moved down. */
  private peakY = 0;

  protected readonly visible = signal(false);

  protected onScroll(): void {
    const view = this.document.defaultView;
    if (!view) return;
    const y = view.scrollY;
    // "Past the hero": the first screen has scrolled out of view.
    const pastHero = y > view.innerHeight * 0.9;
    if (y > this.lastY) this.peakY = y;

    if (!pastHero) this.visible.set(false);
    else if (y > this.lastY) this.visible.set(true);
    else if (this.peakY - y >= UP_TRAVEL) this.visible.set(false);

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
