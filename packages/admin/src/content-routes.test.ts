import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { forgeAdminContentRoutes } from './content-routes.js';
import { ForgeCollectionsIndexComponent } from './collections-index.component.js';
import { ForgeCollectionWorkspaceComponent } from './collection-workspace.component.js';
import {
  ForgeDocumentEditorComponent,
  canDeactivateForgeDocumentEditor
} from './document-editor.component.js';
import { ForgeContentRefresh } from './content-refresh.js';

describe('forgeAdminContentRoutes', () => {
  const routes = forgeAdminContentRoutes();

  it('mounts the collections index at "collections"', () => {
    const index = routes.find((route) => route.path === 'collections');
    expect(index?.component).toBe(ForgeCollectionsIndexComponent);
  });

  it('mounts the workspace at "collections/:collection" with a route-scoped refresh provider', () => {
    const workspace = routes.find((route) => route.path === 'collections/:collection');
    expect(workspace?.component).toBe(ForgeCollectionWorkspaceComponent);
    expect(workspace?.providers).toContain(ForgeContentRefresh);
  });

  it('mounts the editor as "new" and ":id" children, both guarded against unsaved changes', () => {
    const workspace = routes.find((route) => route.path === 'collections/:collection');
    const children = workspace?.children ?? [];

    const createRoute = children.find((route) => route.path === 'new');
    const editRoute = children.find((route) => route.path === ':id');

    expect(createRoute?.component).toBe(ForgeDocumentEditorComponent);
    expect(createRoute?.canDeactivate).toEqual([canDeactivateForgeDocumentEditor]);
    expect(editRoute?.component).toBe(ForgeDocumentEditorComponent);
    expect(editRoute?.canDeactivate).toEqual([canDeactivateForgeDocumentEditor]);
  });
});
