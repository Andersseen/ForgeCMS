import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { injectT } from '@etyma/angular';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnRectangleStackIcon } from 'lumen-icons/rectangle-stack';
import { i18n } from '../i18n/i18n';
import { SiteLocaleService } from '../i18n/site-locale.service';

@Component({
  selector: 'forge-cms-demo-invitation',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon, LmnRectangleStackIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="forge-demo-invitation" aria-labelledby="demo-invitation-title">
      <div class="forge-demo-art" [attr.aria-label]="t('demoInvite.art')">
        <div class="forge-demo-art-inner">
          <div class="forge-demo-art-header">
            <span>Lumea Aesthetics</span><span>{{ t('demoInvite.example') }}</span>
          </div>
          <div class="forge-demo-art-content">
            <h3>{{ t('demoInvite.artTitle.0') }}<br />{{ t('demoInvite.artTitle.1') }}</h3>
            <p>{{ t('demoInvite.artBody') }}</p>
          </div>
          <div class="forge-demo-art-footer">
            <lmn-rectangle-stack [size]="16" /> {{ t('demoInvite.poweredBy') }}
          </div>
        </div>
      </div>
      <div class="forge-demo-copy">
        <p class="forge-section-mark">{{ t('demoInvite.mark') }}</p>
        <h2 id="demo-invitation-title">
          {{ t('demoInvite.title.0') }}<br />{{ t('demoInvite.title.1') }}
        </h2>
        <p>{{ t('demoInvite.body') }}</p>
        <ul class="forge-demo-proof">
          @for (item of proof; track item.id) {
            <li>
              {{ t(item.label) }}
              @if (item.id === 'analytics') {
                <span class="forge-experimental-badge ml-1">{{ t('common.experimental') }}</span>
              }
            </li>
          }
        </ul>
        <a voltButton [routerLink]="site.path('/demo')"
          >{{ t('demoInvite.cta') }} <lmn-arrow-right [size]="16"
        /></a>
      </div>
    </section>
  `
})
export class DemoInvitationComponent {
  /** What the live demo exercises today (see DEMO_EXPLORE on /demo). */
  protected readonly proof = [
    { id: 'content', label: 'demoInvite.proof.content' },
    { id: 'drafts', label: 'demoInvite.proof.drafts' },
    { id: 'uploads', label: 'demoInvite.proof.uploads' },
    { id: 'roles', label: 'demoInvite.proof.roles' },
    { id: 'locales', label: 'demoInvite.proof.locales' },
    { id: 'analytics', label: 'demoInvite.proof.analytics' }
  ] as const;
  protected readonly t = injectT(i18n);
  protected readonly site = inject(SiteLocaleService);
}
