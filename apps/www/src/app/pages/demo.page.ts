import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { injectT } from '@etyma/angular';
import { VoltBadge, VoltNativeButton } from '@voltui/components';
import { MoveInViewDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowTopRightOnSquareIcon } from 'lumen-icons/arrow-top-right-on-square';
import { LmnCheckIcon } from 'lumen-icons/check';
import { LmnClipboardIcon } from 'lumen-icons/clipboard';
import { LmnCodeBracketIcon } from 'lumen-icons/code-bracket';
import { LmnRectangleStackIcon } from 'lumen-icons/rectangle-stack';
import {
  DEMO_ADMIN_URL,
  DEMO_APP_URL,
  DEMO_CREDENTIALS,
  DEMO_EXPLORE,
  DEMO_SOURCE_URL,
  DEVELOPER_STEPS,
  EDITOR_STEPS
} from '../demo-access';
import { FooterComponent } from '../components/footer.component';
import { i18n, textOf, type SiteText } from '../i18n/i18n';
import { HeaderComponent } from '../components/header.component';

@Component({
  selector: 'forge-cms-demo-page',
  standalone: true,
  imports: [
    MoveInViewDirective,
    MoveStaggerDirective,
    VoltBadge,
    VoltNativeButton,
    HeaderComponent,
    FooterComponent,
    LmnArrowTopRightOnSquareIcon,
    LmnCheckIcon,
    LmnClipboardIcon,
    LmnCodeBracketIcon,
    LmnRectangleStackIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-public min-h-screen landing-bg">
      <forge-cms-header />

      <main>
        <section class="mx-auto w-full max-w-7xl px-5 pb-16 pt-14 md:px-8 md:pb-22 md:pt-20">
          <volt-badge variant="secondary">{{ t('demo.badge') }}</volt-badge>
          <div class="mt-6 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 class="forge-display max-w-[16ch] text-5xl md:text-7xl">
                {{ t('demo.title') }}
              </h1>
              <p class="mt-6 max-w-[65ch] text-lg leading-8 text-muted-foreground">
                {{ t('demo.lede') }}
              </p>
            </div>
            <div class="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <a voltButton size="lg" [href]="demoUrl" target="_blank" rel="noreferrer">
                {{ t('demo.openClinic') }}
                <lmn-arrow-top-right-on-square [size]="16" />
              </a>
              <a
                voltButton
                variant="outline"
                size="lg"
                [href]="adminUrl"
                target="_blank"
                rel="noreferrer"
              >
                {{ t('demo.signIn') }}
              </a>
            </div>
          </div>
        </section>

        <section
          class="mx-auto w-full max-w-7xl px-5 pb-14 md:px-8"
          aria-labelledby="explore-title"
        >
          <p class="forge-section-mark">{{ t('demo.exploreMark') }}</p>
          <h2 id="explore-title" class="mt-4 text-2xl font-semibold tracking-[-0.03em]">
            {{ t('demo.exploreTitle') }}
          </h2>
          <div class="mt-8 grid gap-4 md:grid-cols-2">
            @for (group of explore; track group.audience) {
              <div class="forge-flow-card">
                <p class="forge-flow-role">{{ t(group.audience) }}</p>
                <ul class="mt-3 divide-y divide-border text-sm">
                  @for (item of group.items; track item.label) {
                    <li class="py-2.5">
                      <span class="font-medium">{{ t(item.label) }}</span>
                      @if (item.experimental) {
                        <span class="forge-experimental-badge ml-2">{{
                          t('common.experimental')
                        }}</span>
                      }
                      <span class="block text-xs text-muted-foreground">{{
                        text(item.where)
                      }}</span>
                    </li>
                  }
                </ul>
              </div>
            }
          </div>
        </section>

        <section class="border-y border-border bg-background">
          <div class="mx-auto grid w-full max-w-7xl lg:grid-cols-2">
            <article class="px-5 py-14 md:px-8 md:py-18 lg:border-r lg:border-border">
              <div class="flex items-center gap-3">
                <lmn-rectangle-stack
                  tone="primary"
                  background="soft"
                  [padding]="8"
                  [radius]="10"
                  [size]="20"
                />
                <div>
                  <h2 class="text-xl font-semibold tracking-[-0.025em]">
                    {{ t('demo.editorTitle') }}
                  </h2>
                  <p class="mt-1 text-sm text-muted-foreground">
                    {{ t('demo.editorLede') }}
                  </p>
                </div>
              </div>
              <ol class="forge-journey" data-journey="editor" moveStagger="80ms">
                @for (step of editorSteps; track step.title; let index = $index) {
                  <li class="forge-journey-step" [moveInView]="reveal">
                    <span class="forge-journey-number" aria-hidden="true">{{
                      (index + 1).toString().padStart(2, '0')
                    }}</span>
                    <div class="forge-journey-card">
                      <h3>{{ t(step.title) }}</h3>
                      <p>{{ t(step.detail) }}</p>
                    </div>
                  </li>
                }
              </ol>
            </article>

            <article class="px-5 py-14 md:px-8 md:py-18">
              <div class="flex items-center gap-3">
                <lmn-code-bracket
                  tone="info"
                  background="soft"
                  [padding]="8"
                  [radius]="10"
                  [size]="20"
                />
                <div>
                  <h2 class="text-xl font-semibold tracking-[-0.025em]">
                    {{ t('demo.developerTitle') }}
                  </h2>
                  <p class="mt-1 text-sm text-muted-foreground">
                    {{ t('demo.developerLede') }}
                  </p>
                </div>
              </div>
              <ol class="forge-journey" data-journey="developer" moveStagger="80ms">
                @for (step of developerSteps; track step.title; let index = $index) {
                  <li class="forge-journey-step" [moveInView]="reveal">
                    <span class="forge-journey-number" aria-hidden="true">{{
                      (index + 1).toString().padStart(2, '0')
                    }}</span>
                    <div class="forge-journey-card">
                      <h3>{{ t(step.title) }}</h3>
                      <p>{{ t(step.detail) }}</p>
                    </div>
                  </li>
                }
              </ol>
            </article>
          </div>
        </section>

        <section
          class="mx-auto grid w-full max-w-7xl gap-12 px-5 py-18 md:px-8 md:py-24 lg:grid-cols-2"
        >
          <div>
            <p class="forge-section-mark">{{ t('demo.accountsMark') }}</p>
            <h2 class="mt-5 text-3xl font-semibold tracking-[-0.04em]">
              {{ t('demo.accountsTitle') }}
            </h2>
            <p class="mt-4 max-w-[56ch] leading-7 text-muted-foreground">
              {{ t('demo.accountsBody') }}
            </p>
            <div class="mt-8 overflow-hidden rounded-xl border border-border bg-background">
              @for (account of credentials; track account.email) {
                <div
                  class="grid gap-4 border-b border-border p-5 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div>
                    <p class="font-semibold">{{ t(account.role) }}</p>
                    <p class="mt-1 break-all font-mono text-sm text-muted-foreground">
                      {{ account.email }} / {{ account.password }}
                    </p>
                  </div>
                  <button
                    voltButton
                    variant="outline"
                    size="sm"
                    type="button"
                    [attr.aria-label]="t('demo.copyCredentials', { role: t(account.role) })"
                    (click)="copy(account.email, account.password)"
                  >
                    @if (copied() === account.email) {
                      <lmn-check tone="success" [size]="16" />
                      {{ t('common.copied') }}
                    } @else {
                      <lmn-clipboard [size]="16" />
                      {{ t('common.copy') }}
                    }
                  </button>
                </div>
              }
            </div>
          </div>

          <aside class="forge-themed-panel self-start rounded-[1.25rem] p-7 md:p-9">
            <p class="text-sm font-medium text-primary">{{ t('demo.sourceMark') }}</p>
            <h2 class="mt-4 text-3xl font-semibold tracking-[-0.04em]">
              {{ t('demo.sourceTitle') }}
            </h2>
            <p class="mt-4 leading-7 text-muted-foreground">
              {{ t('demo.sourceBody') }}
            </p>
            <ul class="mt-7 space-y-3 font-mono text-sm text-muted-foreground">
              <li>server/api/collections.ts</li>
              <li>routes/api/site/home.get.ts</li>
              <li>docs/DEMO-FINDINGS.md</li>
            </ul>
            <a
              voltButton
              variant="outline"
              class="mt-8"
              [href]="sourceUrl"
              target="_blank"
              rel="noreferrer"
            >
              {{ t('demo.browseSource') }}
              <lmn-arrow-top-right-on-square [size]="16" />
            </a>
          </aside>
        </section>
      </main>
      <forge-cms-footer />
    </div>
  `
})
export class DemoPage {
  protected readonly t = injectT(i18n);
  protected readonly text = (value: SiteText): string => textOf(this.t, value);
  protected readonly demoUrl = DEMO_APP_URL;
  protected readonly adminUrl = DEMO_ADMIN_URL;
  protected readonly sourceUrl = DEMO_SOURCE_URL;
  protected readonly credentials = DEMO_CREDENTIALS;
  protected readonly explore = DEMO_EXPLORE;
  protected readonly editorSteps = EDITOR_STEPS;
  protected readonly reveal = { opacity: [0, 1], y: [16, 0] };
  protected readonly developerSteps = DEVELOPER_STEPS;
  protected readonly copied = signal<string | null>(null);

  protected async copy(email: string, password: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${email} / ${password}`);
      this.copied.set(email);
    } catch {
      this.copied.set(null);
    }
  }
}
