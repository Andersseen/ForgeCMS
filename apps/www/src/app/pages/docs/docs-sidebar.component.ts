import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { injectT } from '@etyma/angular';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CURRENT_FORGE_VERSION } from '../../forge-release';
import type { DocsNavGroup } from './docs-nav';
import { i18n } from '../../i18n/i18n';
import { docsGroupLabel } from './docs-groups';

/**
 * The `/docs` section nav.
 *
 * Desktop gets a sticky rail; mobile gets a native `<details>` disclosure rather than a dialog —
 * it is one element, needs no JavaScript, and closes on navigation because the route change
 * re-renders it.
 */
@Component({
  selector: 'forge-cms-docs-sidebar',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="mb-6 w-full rounded-lg border border-border bg-surface md:hidden">
      <summary
        class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground marker:hidden"
      >
        {{ t('docs.browse') }}
      </summary>
      <div class="border-t border-border px-4 py-3">
        <ng-container [ngTemplateOutlet]="nav" />
      </div>
    </details>

    <aside
      [attr.aria-label]="t('docs.sidebar')"
      class="hidden w-64 shrink-0 md:sticky md:top-8 md:block md:max-h-[calc(100vh-4rem)] md:overflow-y-auto md:overscroll-contain md:pb-10"
    >
      <ng-container [ngTemplateOutlet]="nav" />
    </aside>

    <ng-template #nav>
      <p class="forge-docs-release">
        <span>{{ t('docs.title') }}</span>
        <span class="forge-docs-release-chip">{{ t('docs.release', { version }) }}</span>
      </p>
      <nav class="mt-6 flex flex-col gap-6">
        @for (group of groups(); track group.heading) {
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {{ groupLabel(group.heading) }}
            </p>
            <ul class="mt-2 ml-1 flex flex-col gap-0.5 border-l border-border pl-3">
              @for (link of group.links; track link.slug) {
                <li>
                  <a
                    class="forge-docs-link block truncate rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    routerLinkActive="is-active bg-muted font-medium text-foreground"
                    ariaCurrentWhenActive="page"
                    [routerLink]="link.path ?? '/docs/' + link.slug"
                    [attr.hreflang]="link.englishOnly ? 'en' : null"
                    >{{ link.title }}
                    @if (link.englishOnly) {
                      <abbr class="forge-docs-lang" [attr.title]="t('docs.englishOnlyLabel')">{{
                        t('docs.englishOnly')
                      }}</abbr>
                      <span class="sr-only">({{ t('docs.englishOnlyLabel') }})</span>
                    }
                  </a>
                </li>
              }
            </ul>
          </div>
        }
      </nav>
    </ng-template>
  `
})
export class DocsSidebarComponent {
  readonly groups = input.required<DocsNavGroup[]>();
  protected readonly version = CURRENT_FORGE_VERSION;
  protected readonly t = injectT(i18n);
  protected readonly groupLabel = (heading: string): string => docsGroupLabel(this.t, heading);
}
