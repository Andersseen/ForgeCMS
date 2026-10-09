import { afterNextRender } from '@angular/core';
import type { DestroyRef, Injector } from '@angular/core';

/**
 * `afterNextRender` for code that runs after an `await`: registering on a view that was destroyed in the
 * meantime throws (NG0911), so a cancelled upload or a navigation during a delete must not schedule it.
 */
export function afterNextRenderIfAlive(
  injector: Injector,
  destroyRef: DestroyRef,
  callback: () => void
): void {
  if (destroyRef.destroyed) return;
  afterNextRender(callback, { injector });
}
