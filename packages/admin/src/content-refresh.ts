import { Injectable, signal } from '@angular/core';

/**
 * Internal, not exported from `index.ts`. `forgeAdminContentRoutes()` provides one instance per
 * `collections/:collection` route subtree, so a `ForgeDocumentEditorComponent` (a child route) can
 * tell its `ForgeCollectionWorkspaceComponent` (the parent route) to refetch after a save, without
 * either component knowing about the other or a router-event-sniffing workaround.
 */
@Injectable()
export class ForgeContentRefresh {
  private readonly bumped = signal(0);
  readonly version = this.bumped.asReadonly();

  bump(): void {
    this.bumped.update((count) => count + 1);
  }
}
