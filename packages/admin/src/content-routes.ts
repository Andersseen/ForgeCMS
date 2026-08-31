import type { Routes } from '@angular/router';
import { ForgeCollectionsIndexComponent } from './collections-index.component.js';
import { ForgeCollectionWorkspaceComponent } from './collection-workspace.component.js';
import {
  ForgeDocumentEditorComponent,
  canDeactivateForgeDocumentEditor
} from './document-editor.component.js';
import { ForgeContentRefresh } from './content-refresh.js';

/**
 * The generic content-CRUD route subtree: a collections index, and per-collection workspace with a
 * create/edit overlay. Nest it under whatever a host already mounts its admin layout at:
 *
 * ```ts
 * {
 *   path: 'admin',
 *   component: ForgeAdminLayoutComponent,
 *   children: [...forgeAdminContentRoutes(), ...appSpecificRoutes]
 * }
 * ```
 *
 * No `basePath` option — Angular's own route nesting already supplies that. This does not include
 * the layout route, dashboard, media, users, settings, or API pages; those stay the host's own
 * (spec 052 non-goals).
 */
export function forgeAdminContentRoutes(): Routes {
  return [
    { path: 'collections', component: ForgeCollectionsIndexComponent },
    {
      path: 'collections/:collection',
      component: ForgeCollectionWorkspaceComponent,
      providers: [ForgeContentRefresh],
      children: [
        {
          path: 'new',
          component: ForgeDocumentEditorComponent,
          canDeactivate: [canDeactivateForgeDocumentEditor]
        },
        {
          path: ':id',
          component: ForgeDocumentEditorComponent,
          canDeactivate: [canDeactivateForgeDocumentEditor]
        }
      ]
    }
  ];
}
