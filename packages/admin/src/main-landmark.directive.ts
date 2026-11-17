import { Directive, ElementRef, afterNextRender, inject, signal } from '@angular/core';

/**
 * Makes its host the page's `main` landmark (spec 104), unless the host app already wraps the admin in
 * one: a second, nested `main` would be a new WCAG violation (axe `landmark-no-duplicate-main`,
 * `landmark-main-is-top-level`) for a 1.0 app that did. The server render always carries the role;
 * the browser drops it after the first render when an ancestor `main` landmark exists.
 *
 * Internal: not exported from the package entry point.
 */
@Directive({
  selector: '[forgeMainLandmark]',
  standalone: true,
  host: { '[attr.role]': "owns() ? 'main' : null" }
})
export class ForgeMainLandmarkDirective {
  protected readonly owns = signal(true);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      if (host.parentElement?.closest('main, [role="main"]')) this.owns.set(false);
    });
  }
}
