import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { ConfigurableFocusTrapFactory } from '@angular/cdk/a11y';
import type { FocusTrap } from '@angular/cdk/a11y';

/** How long to wait before retrying a focus restore whose target had not re-rendered yet. */
const RESTORE_RETRY_MS = 150;

/**
 * The one modal focus contract for the admin's hand-rolled dialogs (spec 086).
 *
 * Put on the dialog's overlay element, which Angular creates when the dialog opens and removes when
 * it closes — so the element's lifetime *is* the dialog's lifetime:
 *
 * - **Open:** remember the element that had focus, then move focus inside (a component-chosen initial
 *   control, otherwise the first tabbable one).
 * - **While open:** Tab and Shift+Tab wrap inside (`@angular/cdk/a11y`'s focus trap — a maintained
 *   primitive, not a hand-written Tab cycle).
 * - **Close:** give focus back to the remembered element. When that element is gone (a deleted row,
 *   a closed editor) fall back to the page's `h1`, never to a disconnected node.
 *
 * Internal: not exported from the package entry point.
 */
@Directive({ selector: '[forgeModalFocus]', standalone: true })
export class ForgeModalFocusDirective implements OnDestroy {
  /** A static selector for the control that should receive focus first; the first tabbable otherwise. */
  readonly initialFocus = input<string | null>(null, { alias: 'forgeModalFocus' });

  private readonly doc = inject(DOCUMENT);
  private readonly trap: FocusTrap;
  private readonly opener: HTMLElement | null;
  private readonly host: HTMLElement;
  /** How many dialogs were already open when this one opened (0 = outermost). */
  private readonly depth = open.length;

  constructor() {
    open.push(this);
    this.host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const active = this.doc.activeElement;
    this.opener = active instanceof HTMLElement && active !== this.doc.body ? active : null;
    // Anchors are attached after the first render: the host has no parent node yet in a constructor.
    this.trap = inject(ConfigurableFocusTrapFactory).create(this.host, true);

    afterNextRender(() => {
      this.trap.attachAnchors();
      const selector = this.initialFocus();
      const initial = selector ? this.host.querySelector<HTMLElement>(selector) : null;
      if (initial) initial.focus();
      else void this.trap.focusInitialElementWhenReady();
    });
  }

  ngOnDestroy(): void {
    this.trap.destroy();
    open = open.filter((dialog) => dialog !== this);
    closed.push(this);
    if (flushScheduled) return;
    flushScheduled = true;
    // After the dialogs' own DOM is gone, so "is the opener still there?" has a real answer.
    queueMicrotask(flush);
  }

  /** Whether focus is on nothing in particular — the state after the focused node was removed. */
  private static focusIsLost(doc: Document): boolean {
    const active = doc.activeElement;
    return active === null || active === doc.body || !active.isConnected;
  }

  private restore(): boolean {
    const target = this.opener?.isConnected ? this.opener : this.heading();
    if (target === null) return false;
    target.focus();
    return this.doc.activeElement === target;
  }

  private heading(): HTMLElement | null {
    const heading = this.doc.querySelector<HTMLElement>('h1');
    if (heading === null) return null;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    return heading;
  }

  /** Restores for the dialogs closed in one tick; the outermost (lowest depth) dialog's opener wins. */
  static restoreClosed(batch: ForgeModalFocusDirective[], retry: boolean): void {
    const ordered = [...batch].sort((a, b) => a.depth - b.depth);
    const doc = ordered[0]?.doc;
    // Something else (an outer dialog that stays open) already holds focus: leave it alone.
    if (doc === undefined || !ForgeModalFocusDirective.focusIsLost(doc)) return;
    if (ordered.some((dialog) => dialog.restore()) || !retry) return;
    // The target may not have re-rendered yet (a list reloading after a save): look once more.
    setTimeout(() => ForgeModalFocusDirective.restoreClosed(ordered, false), RESTORE_RETRY_MS);
  }
}

let open: ForgeModalFocusDirective[] = [];
let closed: ForgeModalFocusDirective[] = [];
let flushScheduled = false;

function flush(): void {
  flushScheduled = false;
  const batch = closed;
  closed = [];
  ForgeModalFocusDirective.restoreClosed(batch, true);
}
