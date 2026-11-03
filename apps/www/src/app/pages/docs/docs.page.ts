import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { injectContentFiles } from '@analogjs/content';
import { HeaderComponent } from '../../components/header.component';
import { SiteLocaleService } from '../../i18n/site-locale.service';
import { localizePath } from '../../i18n/site-locales.mjs';
import {
  buildDocsNav,
  isDocsFile,
  isLocalizedDocsFile,
  localizeDocsNav,
  type DocsFrontmatter
} from './docs-nav';
import { DocsSidebarComponent } from './docs-sidebar.component';

/**
 * The `/docs` shell: site header, section nav, and the article outlet.
 *
 * It owns the nav so the sidebar is built once and survives navigation between pages — only the
 * outlet swaps. `injectContentFiles` reads frontmatter that Analog's content plugin collected at
 * build time, so this costs no request. Under `/es/docs` and `/uk/docs` the same English order is
 * shown with translated titles where a translation exists (spec 101); the rest link to English.
 */
@Component({
  selector: 'forge-cms-docs',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, DocsSidebarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-public min-h-screen bg-background">
      <forge-cms-header />
      <div
        class="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8 md:flex-row md:gap-12 md:px-8 md:py-12"
      >
        <forge-cms-docs-sidebar [groups]="groups()" />
        <main class="min-w-0 flex-1">
          <router-outlet />
        </main>
      </div>
    </div>
  `
})
export class DocsPage {
  private readonly site = inject(SiteLocaleService);
  private readonly english = injectContentFiles<DocsFrontmatter>(isDocsFile);
  private readonly translated = injectContentFiles<DocsFrontmatter>(
    (file) => isLocalizedDocsFile(file, 'es') || isLocalizedDocsFile(file, 'uk')
  );
  private readonly englishNav = buildDocsNav(this.english);

  protected readonly groups = computed(() => {
    const locale = this.site.locale();
    const translations =
      locale === 'en'
        ? this.english
        : this.translated.filter((file) => isLocalizedDocsFile(file, locale));
    return localizeDocsNav(this.englishNav, translations, (slug, translated) =>
      localizePath(`/docs/${slug}`, translated ? locale : 'en')
    );
  });
}
