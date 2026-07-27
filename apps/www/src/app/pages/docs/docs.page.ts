import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { injectContentFiles } from '@analogjs/content';
import { DemoDialogComponent } from '../../components/demo-dialog.component';
import { HeaderComponent } from '../../components/header.component';
import { buildDocsNav, isDocsFile, type DocsFrontmatter } from './docs-nav';
import { DocsSidebarComponent } from './docs-sidebar.component';

/**
 * The `/docs` shell: site header, section nav, and the article outlet.
 *
 * It owns the nav so the sidebar is built once and survives navigation between pages — only the
 * outlet swaps. `injectContentFiles` reads frontmatter that Analog's content plugin collected at
 * build time, so this costs no request.
 */
@Component({
  selector: 'forge-cms-docs',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, DemoDialogComponent, DocsSidebarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-background">
      <forge-cms-header />
      <div
        class="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8 md:flex-row md:gap-12 md:px-8 md:py-12"
      >
        <forge-cms-docs-sidebar [groups]="groups" />
        <main class="min-w-0 flex-1">
          <router-outlet />
        </main>
      </div>
      <forge-cms-demo-dialog />
    </div>
  `
})
export class DocsPage {
  // Build-time constant, not reactive state — no signal needed.
  protected readonly groups = buildDocsNav(injectContentFiles<DocsFrontmatter>(isDocsFile));
}
