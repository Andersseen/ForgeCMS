import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { injectT } from '@etyma/angular';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltNativeButton } from '@voltui/components';
import { MoveInViewDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { CURRENT_FORGE_VERSION } from '../forge-release';
import { packages } from '../landing-data';
import { i18n } from '../i18n/i18n';
import { SiteLocaleService } from '../i18n/site-locale.service';
import { RichMessageComponent } from './rich-message.component';

/**
 * Spec 097: the twelve packages as the stack they form — Angular experience on top of the runtime and
 * platform adapters, on top of the foundation — with quality and tooling alongside. Every package keeps
 * its name, purpose and honest version label in plain text; the layers only add structure.
 */
@Component({
  selector: 'forge-cms-packages-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltBadge,
    VoltNativeButton,
    MoveInViewDirective,
    MoveStaggerDirective,
    LmnArrowRightIcon,
    RichMessageComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="packages" class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
      <div class="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p class="forge-section-mark">{{ t('packages.mark') }}</p>
          <h2 class="forge-section-title mt-5 max-w-[16ch]">
            {{ t('packages.title') }}
          </h2>
          <p class="mt-5 max-w-[52ch] leading-7 text-muted-foreground">
            <forge-cms-rich-message
              [parts]="i18n.parts('packages.lede', { version })"
              strongClass="font-semibold text-foreground"
            />
          </p>
        </div>
        <dl class="forge-pkg-stats">
          <div>
            <dt>{{ t('packages.total') }}</dt>
            <dd>{{ total }}</dd>
          </div>
          <div>
            <dt>{{ t('packages.stable') }}</dt>
            <dd>{{ stable }}</dd>
          </div>
          <div>
            <dt>{{ t('packages.experimental') }}</dt>
            <dd>{{ total - stable }}</dd>
          </div>
        </dl>
      </div>

      <div class="forge-pkg-board">
        <div class="forge-pkg-stack" moveStagger="90ms">
          @for (layer of layers; track layer.id) {
            <section
              class="forge-pkg-layer"
              [attr.data-layer]="layer.id"
              [attr.aria-labelledby]="'pkg-layer-' + layer.id"
              [moveInView]="reveal"
            >
              <header>
                <h3 [id]="'pkg-layer-' + layer.id">{{ t(layer.label) }}</h3>
                <p>{{ t(layer.description) }}</p>
              </header>
              <ul class="forge-pkg-tiles">
                @for (pkg of layer.items; track pkg.name) {
                  <li class="forge-pkg-tile">
                    <code><span class="forge-pkg-scope">&#64;forge-cms/</span>{{ pkg.name }}</code>
                    <p>{{ t(pkg.purpose) }}</p>
                    <volt-badge variant="secondary">{{
                      pkg.version ?? t('packages.notYetPublished')
                    }}</volt-badge>
                  </li>
                }
              </ul>
            </section>
          }
        </div>

        <section
          class="forge-pkg-layer forge-pkg-side"
          data-layer="tooling"
          aria-labelledby="pkg-layer-tooling"
          [moveInView]="reveal"
        >
          <header>
            <h3 id="pkg-layer-tooling">{{ t(tooling.label) }}</h3>
            <p>{{ t(tooling.description) }}</p>
          </header>
          <ul class="forge-pkg-tiles">
            @for (pkg of tooling.items; track pkg.name) {
              <li class="forge-pkg-tile">
                <code><span class="forge-pkg-scope">&#64;forge-cms/</span>{{ pkg.name }}</code>
                <p>{{ t(pkg.purpose) }}</p>
                <span class="flex flex-wrap items-center gap-1.5">
                  @if (pkg.availability === 'experimental') {
                    <span class="forge-experimental-badge">{{ t('common.experimental') }}</span>
                  }
                  <volt-badge variant="secondary">{{
                    pkg.version ?? t('packages.notYetPublished')
                  }}</volt-badge>
                </span>
              </li>
            }
          </ul>
        </section>
      </div>

      <div class="mt-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <p class="max-w-3xl text-sm leading-6 text-muted-foreground">
          {{ t('packages.adapters') }}
        </p>
        <a voltButton variant="outline" class="shrink-0" [routerLink]="site.docsPath('quickstart')">
          {{ t('packages.quickstart') }}
          <lmn-arrow-right [size]="16" />
        </a>
      </div>
    </section>
  `
})
export class PackagesSectionComponent {
  protected readonly site = inject(SiteLocaleService);
  protected readonly i18n = this.site.i18n;
  protected readonly t = injectT(i18n);
  protected readonly version = CURRENT_FORGE_VERSION;
  protected readonly total = packages.length;
  protected readonly stable = packages.filter((pkg) => pkg.availability === 'stable').length;
  protected readonly reveal = { opacity: [0, 1], y: [18, 0] };
  /** Top of the stack first, as it reads: what you see, what runs it, what it stands on. */
  protected readonly layers = [
    {
      id: 'angular',
      label: 'packages.layers.angular.label',
      description: 'packages.layers.angular.description',
      items: packages.filter((pkg) => ['angular', 'admin'].includes(pkg.name))
    },
    {
      id: 'runtime',
      label: 'packages.layers.runtime.label',
      description: 'packages.layers.runtime.description',
      items: packages.filter((pkg) => ['api', 'runtime', 'cloudflare', 's3'].includes(pkg.name))
    },
    {
      id: 'foundation',
      label: 'packages.layers.foundation.label',
      description: 'packages.layers.foundation.description',
      items: packages.filter((pkg) => ['core', 'db', 'auth', 'storage'].includes(pkg.name))
    }
  ] as const;
  protected readonly tooling = {
    label: 'packages.layers.tooling.label',
    description: 'packages.layers.tooling.description',
    items: packages.filter((pkg) => ['testing', 'agent'].includes(pkg.name))
  } as const;
}
