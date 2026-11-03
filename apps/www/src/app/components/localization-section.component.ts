import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { injectT } from '@etyma/angular';
import { RouterLink } from '@angular/router';
import { VoltNativeButton, VoltToggleGroup, VoltToggleGroupItem } from '@voltui/components';
import { MoveVariantsDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { localizationExample } from '../landing-data';
import { i18n } from '../i18n/i18n';
import { SiteLocaleService } from '../i18n/site-locale.service';

type LocaleCode = 'ES' | 'EN';

/**
 * Spec 097: localization as an editor. The ES/EN switch changes the values the editor shows (a short
 * Movement variant marks the change); the per-locale grid underneath always shows both, so nothing
 * depends on clicking or on motion. Only top-level `text`/`textarea` fields are localized in 1.0, and
 * the shared fields say so.
 */
@Component({
  selector: 'forge-cms-localization-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltNativeButton,
    VoltToggleGroup,
    VoltToggleGroupItem,
    MoveVariantsDirective,
    LmnArrowRightIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="localization"
      class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-24"
      aria-labelledby="localization-title"
    >
      <div class="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <p class="forge-section-mark">{{ t('localization.mark') }}</p>
          <h2 id="localization-title" class="forge-section-title mt-5">
            {{ t('localization.title') }}
          </h2>
          <p class="mt-5 max-w-[46ch] leading-7 text-muted-foreground">
            {{ t('localization.lede') }}
          </p>
          <pre
            class="forge-code mt-7 hidden md:block"
            tabindex="0"
          ><code>{{ example.schema }}</code></pre>
          <p class="mt-5 text-sm leading-6 text-muted-foreground">{{ t(example.limits) }}</p>
          <a voltButton variant="outline" class="mt-6" [routerLink]="site.docsPath('collections')">
            {{ t('localization.guide') }}
            <lmn-arrow-right [size]="16" />
          </a>
        </div>

        <div class="forge-l10n">
          <div class="forge-l10n-editor" role="group" aria-labelledby="l10n-editor-title">
            <div class="forge-l10n-bar">
              <p id="l10n-editor-title">
                <span class="text-muted-foreground">{{ t('localization.notices') }}</span>
                {{ current().title }}
              </p>
              <volt-toggle-group
                class="forge-l10n-switch"
                type="single"
                [attr.aria-label]="t('localization.editingLocale')"
                [value]="[locale()]"
                (valueChange)="selectLocale($event)"
              >
                @for (code of codes; track code) {
                  <volt-toggle-group-item [value]="code" size="sm">{{
                    code
                  }}</volt-toggle-group-item>
                }
              </volt-toggle-group>
            </div>
            <div class="forge-l10n-fields">
              <div class="forge-l10n-field">
                <span class="forge-l10n-label"
                  >{{ t('localization.fieldTitle') }} <em>{{ locale() }}</em></span
                >
                <span
                  class="forge-l10n-value"
                  [moveVariants]="swap"
                  [moveVariant]="locale()"
                  aria-live="polite"
                  >{{ current().title }}</span
                >
              </div>
              <div class="forge-l10n-field">
                <span class="forge-l10n-label"
                  >{{ t('localization.description') }} <em>{{ locale() }}</em></span
                >
                <span
                  class="forge-l10n-value is-multiline"
                  [moveVariants]="swap"
                  [moveVariant]="locale()"
                  >{{ current().description }}</span
                >
              </div>
              <div class="forge-l10n-field is-shared">
                <span class="forge-l10n-label"
                  >{{ t('localization.slug') }} <em>{{ t('localization.shared') }}</em></span
                >
                <span class="forge-l10n-value">tratamientos-faciales</span>
              </div>
              <div class="forge-l10n-field is-shared">
                <span class="forge-l10n-label"
                  >{{ t('localization.image') }} <em>{{ t('localization.shared') }}</em></span
                >
                <span class="forge-l10n-value">facial.jpg</span>
              </div>
            </div>
            <p class="forge-l10n-foot">{{ t('localization.foot') }}</p>
          </div>

          <table class="forge-l10n-table">
            <caption>
              {{
                t('localization.caption')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('localization.field') }}</th>
                @for (entry of example.locales; track entry.code) {
                  <th scope="col">{{ entry.code }}</th>
                }
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{{ t('localization.fieldTitle') }}</th>
                @for (entry of example.locales; track entry.code) {
                  <td [class.is-current]="entry.code === locale()">{{ entry.title }}</td>
                }
              </tr>
              <tr>
                <th scope="row">{{ t('localization.description') }}</th>
                @for (entry of example.locales; track entry.code) {
                  <td [class.is-current]="entry.code === locale()">{{ entry.description }}</td>
                }
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `
})
export class LocalizationSectionComponent {
  protected readonly t = injectT(i18n);
  protected readonly site = inject(SiteLocaleService);
  protected readonly example = localizationExample;
  protected readonly codes: readonly LocaleCode[] = ['ES', 'EN'];
  protected readonly locale = signal<LocaleCode>('ES');
  protected readonly current = computed(
    () =>
      this.example.locales.find((entry) => entry.code === this.locale()) ?? this.example.locales[0]
  );
  /** `single` groups report an empty array on deselection; keep the current locale then. */
  protected selectLocale(values: readonly string[]): void {
    const next = values.find((v): v is LocaleCode => v === 'ES' || v === 'EN');
    if (next) this.locale.set(next);
  }
  /** Same end state for both locales: the variant change replays a short settle as the value swaps. */
  protected readonly swap = {
    ES: { opacity: [0.2, 1], y: [6, 0], duration: 260 },
    EN: { opacity: [0.2, 1], y: [6, 0], duration: 260 }
  };
}
