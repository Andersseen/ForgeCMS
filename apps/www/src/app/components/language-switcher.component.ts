import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import {
  VoltDropdownMenu,
  VoltDropdownMenuItem,
  VoltDropdownMenuTrigger,
  VoltNativeButton
} from '@voltui/components';
import { injectT } from '@etyma/angular';
import { LmnCheckIcon } from 'lumen-icons/check';
import { LmnLanguageIcon } from 'lumen-icons/language';
import { filter, map } from 'rxjs';
import { i18n } from '../i18n/i18n';
import { SiteLocaleService } from '../i18n/site-locale.service';
import { languageTargets } from '../i18n/language-targets';

/**
 * The header language menu (spec 101). Each entry navigates to the same page in that language when it
 * exists there, and otherwise deliberately to that language's docs home (or home page), saying so. The
 * URL stays the only source of truth: nothing is remembered in storage.
 */
@Component({
  selector: 'forge-cms-language-switcher',
  standalone: true,
  imports: [
    VoltDropdownMenu,
    VoltDropdownMenuItem,
    VoltDropdownMenuTrigger,
    VoltNativeButton,
    LmnCheckIcon,
    LmnLanguageIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      voltButton
      variant="ghost"
      size="sm"
      type="button"
      class="forge-language-trigger"
      [voltDropdownMenu]="menu"
      placement="bottom-end"
      [attr.aria-label]="t('language.trigger', { language: current().name })"
    >
      <lmn-language [size]="16" />
      <span class="forge-language-code" aria-hidden="true">{{ current().code }}</span>
    </button>
    <ng-template #menu>
      <volt-dropdown-menu class="forge-language-menu" [attr.aria-label]="t('language.label')">
        @for (option of options(); track option.locale) {
          <volt-dropdown-menu-item
            [attr.lang]="option.locale"
            [attr.aria-current]="option.current ? 'true' : null"
            [attr.title]="
              option.fallback ? t('language.fallback', { language: option.name }) : null
            "
            (click)="go(option.url)"
          >
            <span class="forge-language-check" aria-hidden="true">
              @if (option.current) {
                <lmn-check [size]="16" />
              }
            </span>
            <span>{{ option.name }}</span>
            @if (option.fallback) {
              <span class="sr-only">{{ t('language.fallback', { language: option.name }) }}</span>
            }
          </volt-dropdown-menu-item>
        }
      </volt-dropdown-menu>
    </ng-template>
  `
})
export class LanguageSwitcherComponent {
  protected readonly t = injectT(i18n);
  private readonly site = inject(SiteLocaleService);
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  protected readonly options = computed(() =>
    languageTargets(this.url(), this.site.locale(), this.site.localesOf(this.url()))
  );
  protected readonly current = computed(
    () => this.options().find((option) => option.current) ?? this.options()[0]!
  );

  protected go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
