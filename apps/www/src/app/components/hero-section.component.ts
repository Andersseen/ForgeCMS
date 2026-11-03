import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { injectT } from '@etyma/angular';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnCheckIcon } from 'lumen-icons/check';
import { LmnClipboardIcon } from 'lumen-icons/clipboard';
import { CURRENT_FORGE_VERSION, CURRENT_RC_VERSION } from '../forge-release';
import { i18n } from '../i18n/i18n';
import { SiteLocaleService } from '../i18n/site-locale.service';
import { installCommand } from '../landing-data';
import { HeroEmberComponent } from './hero-ember.component';
import { ProductShowcaseComponent } from './product-showcase.component';

@Component({
  selector: 'forge-cms-hero-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltBadge,
    VoltNativeButton,
    LmnArrowRightIcon,
    LmnCheckIcon,
    LmnClipboardIcon,
    HeroEmberComponent,
    ProductShowcaseComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="product" class="forge-product-hero">
      <div class="forge-hero-stage">
        <div class="forge-hero-intro">
          <volt-badge variant="secondary" class="forge-release-badge">{{
            t('hero.badge', { version })
          }}</volt-badge>
          <h1>
            {{ t('hero.title.0') }}<br />{{ t('hero.title.1')
            }}<br class="forge-hero-mobile-break" />
            {{ t('hero.title.2') }}
          </h1>
          <p>{{ t('hero.lede') }}</p>
          <div class="forge-hero-actions">
            <a
              voltButton
              size="lg"
              [routerLink]="site.docsPath('small-project-guide')"
              class="forge-brand-button"
              >{{ t('hero.startBuilding') }} <lmn-arrow-right [size]="20"
            /></a>
            <a
              voltButton
              variant="outline"
              size="lg"
              [routerLink]="site.path('/demo')"
              class="forge-dark-outline"
              >{{ t('hero.exploreDemo') }}</a
            >
          </div>
        </div>
        <div class="forge-hero-platforms">
          <span>{{ t('hero.platforms.0') }}</span
          ><span>{{ t('hero.platforms.1') }}</span
          ><span>{{ t('hero.platforms.2') }}</span>
        </div>
        <forge-cms-hero-ember />
      </div>
      <forge-cms-product-showcase />
      <div class="forge-install">
        <div class="forge-install-command" [attr.aria-label]="t('hero.installCommand')">
          <span aria-hidden="true" class="forge-command-prompt">$</span>
          <code>{{ command }}</code>
        </div>
        <button
          voltButton
          variant="ghost"
          size="icon"
          type="button"
          [attr.aria-label]="t('hero.copyInstall')"
          (click)="copy()"
        >
          @if (copyStatus() === 'copied') {
            <lmn-check [size]="20" />
          } @else {
            <lmn-clipboard [size]="20" />
          }
        </button>
        <p class="forge-copy-status" role="status">
          @switch (copyStatus()) {
            @case ('copied') {
              {{ t('common.copied') }}
            }
            @case ('failed') {
              {{ t('hero.copyFallback') }}
            }
          }
        </p>
      </div>
      <p class="forge-hero-note">
        {{ t('hero.note', { version, candidate }) }}
      </p>
    </section>
  `
})
export class HeroSectionComponent {
  protected readonly command = installCommand;
  protected readonly version = CURRENT_FORGE_VERSION;
  protected readonly candidate = CURRENT_RC_VERSION;
  protected readonly copyStatus = signal<'' | 'copied' | 'failed'>('');
  protected readonly t = injectT(i18n);
  protected readonly site = inject(SiteLocaleService);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.command);
      this.copyStatus.set('copied');
    } catch {
      this.copyStatus.set('failed');
    }
  }
}
