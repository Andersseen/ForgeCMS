import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { DocsNavGroup } from './docs-nav';

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
        Browse documentation
      </summary>
      <div class="border-t border-border px-4 py-3">
        <ng-container [ngTemplateOutlet]="nav" />
      </div>
    </details>

    <aside
      aria-label="Documentation"
      class="hidden w-64 shrink-0 md:sticky md:top-8 md:block md:max-h-[calc(100vh-4rem)] md:overflow-y-auto md:overscroll-contain md:pb-10"
    >
      <ng-container [ngTemplateOutlet]="nav" />
    </aside>

    <ng-template #nav>
      <nav class="flex flex-col gap-6">
        @for (group of groups(); track group.heading) {
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {{ group.heading }}
            </p>
            <ul class="mt-2 ml-1 flex flex-col gap-0.5 border-l border-border pl-3">
              @for (link of group.links; track link.slug) {
                <li>
                  <a
                    class="block truncate rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    routerLinkActive="bg-muted font-medium text-foreground"
                    [routerLink]="['/docs', link.slug]"
                    >{{ link.title }}</a
                  >
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
}
