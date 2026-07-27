import { Injectable, signal } from '@angular/core';

/**
 * Opens the "try the demo" dialog from anywhere on the landing page.
 *
 * The header and the hero both need to trigger it while the dialog itself is rendered once, at the
 * page level — a signal in a root service is the smallest thing that does that.
 */
@Injectable({ providedIn: 'root' })
export class DemoDialogService {
  private readonly openState = signal(false);

  readonly isOpen = this.openState.asReadonly();

  open(): void {
    this.openState.set(true);
  }

  close(): void {
    this.openState.set(false);
  }
}
