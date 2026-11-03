import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { injectT } from '@etyma/angular';
import { ScrollTopComponent } from './scroll-top.component';
import { CURRENT_FORGE_VERSION } from '../forge-release';
import { i18n } from '../i18n/i18n';
import { SiteLocaleService } from '../i18n/site-locale.service';

@Component({
  selector: 'forge-cms-footer',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon, ScrollTopComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <forge-cms-scroll-top />
    <section class="border-t border-border bg-background px-5 py-16 md:px-8 md:py-20">
      <div
        class="mx-auto flex w-full max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center"
      >
        <div>
          <h2
            class="max-w-[16ch] text-3xl font-semibold leading-tight tracking-[-0.04em] md:text-4xl"
          >
            {{ t('footer.title') }}
          </h2>
          <p class="mt-3 max-w-xl leading-7 text-muted-foreground">
            {{ t('footer.body') }}
          </p>
        </div>
        <div class="flex shrink-0 flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
          <a voltButton size="lg" [routerLink]="site.path('/demo')">
            {{ t('footer.exploreDemo') }}
            <lmn-arrow-right [size]="16" />
          </a>
          <a voltButton variant="outline" size="lg" [routerLink]="site.path('/docs')">{{
            t('footer.readDocs')
          }}</a>
        </div>
      </div>
    </section>

    <footer class="border-t border-border bg-background px-5 py-9 md:px-8">
      <div
        class="mx-auto flex w-full max-w-7xl flex-col gap-7 md:flex-row md:items-center md:justify-between"
      >
        <a
          class="inline-flex items-center gap-3 font-semibold text-foreground"
          [routerLink]="site.path('/')"
        >
          <img class="size-8 rounded-md" src="/logo.svg" alt="" width="32" height="32" />
          <span>ForgeCMS</span>
        </a>
        <nav
          class="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground"
          [attr.aria-label]="t('footer.nav')"
        >
          <a class="forge-footer-link" [routerLink]="site.path('/')">{{
            t('navigation.product')
          }}</a>
          <a class="forge-footer-link" [routerLink]="site.path('/demo')">{{
            t('navigation.demo')
          }}</a>
          <a class="forge-footer-link" [routerLink]="site.path('/docs')">{{
            t('navigation.docs')
          }}</a>
          <a class="forge-footer-link" [routerLink]="site.docsPath('roadmap')">{{
            t('footer.roadmap')
          }}</a>
          <a class="forge-footer-link" [routerLink]="site.docsPath('agent-kit')">{{
            t('footer.agentKit')
          }}</a>
          <a class="forge-footer-link" [routerLink]="site.docsPath('analytics')">{{
            t('footer.analytics')
          }}</a>
          <a class="forge-footer-link" [routerLink]="site.docsPath('schema-upgrades')">{{
            t('footer.upgrades')
          }}</a>
          <a class="forge-footer-link" [routerLink]="site.path('/privacy')">{{
            t('footer.privacy')
          }}</a>
          <a
            class="forge-footer-link"
            href="https://github.com/Andersseen/ForgeCMS"
            rel="noreferrer"
            target="_blank"
            >GitHub</a
          >
          <a
            class="forge-footer-link"
            href="https://www.npmjs.com/org/forge-cms"
            rel="noreferrer"
            target="_blank"
            >npm</a
          >
        </nav>
        <p class="text-xs text-muted-foreground">
          {{ t('footer.legal', { version: version }) }}
        </p>
      </div>
    </footer>
  `
})
export class FooterComponent {
  protected readonly site = inject(SiteLocaleService);
  protected readonly t = injectT(i18n);
  protected readonly version = CURRENT_FORGE_VERSION;
}
