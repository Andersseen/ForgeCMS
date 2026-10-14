import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteApiService } from '../../services/site-api.service';
import type { SiteLocale } from '../../../shared/site-content';
import { asyncState } from './async-state';

/**
 * "From the clinic" — the one piece of the public site that is localized CMS content (spec 094).
 *
 * The notice text comes from the `notices` collection read in the requested language by
 * `/api/site/notices/:locale`; everything else on the site stays English on purpose. The language
 * is an input, not state held here, so two requests can never share a locale. A failure hides the
 * banner instead of the page: a notice is an extra, never the content a visitor came for.
 */
@Component({
  selector: 'lumea-notice-banner',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state.data()?.[0]; as notice) {
      <aside
        class="border-b border-border/60 bg-muted/60"
        aria-label="From the clinic"
        [attr.lang]="locale()"
        data-testid="clinic-notice"
      >
        <div
          class="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-4"
        >
          <p class="font-medium">{{ notice.title }}</p>
          <p class="text-muted-foreground sm:flex-1">{{ notice.message }}</p>
          @if (notice.linkLabel) {
            <a
              [routerLink]="notice.linkPath"
              queryParamsHandling="preserve"
              class="font-medium underline underline-offset-4"
            >
              {{ notice.linkLabel }} →
            </a>
          }
        </div>
      </aside>
    }
  `
})
export class NoticeBanner {
  private readonly api = inject(SiteApiService);

  readonly locale = input.required<SiteLocale>();

  protected readonly state = asyncState<Awaited<ReturnType<SiteApiService['notices']>>>();

  constructor() {
    effect(() => {
      const locale = this.locale();
      this.state.reload(() => this.api.notices(locale));
    });
  }
}
