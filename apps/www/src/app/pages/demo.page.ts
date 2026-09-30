import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { VoltBadge, VoltNativeButton } from '@voltui/components';
import { LmnArrowTopRightOnSquareIcon } from 'lumen-icons/arrow-top-right-on-square';
import { LmnCheckIcon } from 'lumen-icons/check';
import { LmnClipboardIcon } from 'lumen-icons/clipboard';
import { LmnCodeBracketIcon } from 'lumen-icons/code-bracket';
import { LmnRectangleStackIcon } from 'lumen-icons/rectangle-stack';
import {
  DEMO_ADMIN_URL,
  DEMO_APP_URL,
  DEMO_CREDENTIALS,
  DEMO_SOURCE_URL,
  DEVELOPER_STEPS,
  EDITOR_STEPS
} from '../demo-access';
import { FooterComponent } from '../components/footer.component';
import { HeaderComponent } from '../components/header.component';

@Component({
  selector: 'forge-cms-demo-page',
  standalone: true,
  imports: [
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
    <main class="min-h-screen overflow-hidden landing-bg">
      <forge-cms-header />

      <section class="mx-auto w-full max-w-7xl px-5 pb-16 pt-14 md:px-8 md:pb-22 md:pt-20">
        <volt-badge variant="secondary">Live demo</volt-badge>
        <div class="mt-6 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 class="forge-display max-w-[16ch] text-5xl md:text-7xl">
              Lumea is a clinic built from content, not a screenshot.
            </h1>
            <p class="mt-6 max-w-[65ch] text-lg leading-8 text-muted-foreground">
              Treatments, prices, staff, journal, bookings and the homepage layout all live in
              ForgeCMS. Visit the public site, then sign in and change the content that produced it.
            </p>
          </div>
          <div class="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <a voltButton size="lg" [href]="demoUrl" target="_blank" rel="noreferrer">
              Open the clinic
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
              Sign in to the CMS
            </a>
          </div>
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
                <h2 class="text-xl font-semibold tracking-[-0.025em]">See it as an editor</h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  Publish something and watch it move.
                </p>
              </div>
            </div>
            <ol class="mt-9 border-t border-border">
              @for (step of editorSteps; track step.title; let index = $index) {
                <li class="grid grid-cols-[2rem_1fr] gap-4 border-b border-border py-5">
                  <span class="font-mono text-xs text-muted-foreground">{{
                    (index + 1).toString().padStart(2, '0')
                  }}</span>
                  <div>
                    <h3 class="font-semibold">{{ step.title }}</h3>
                    <p class="mt-2 text-sm leading-6 text-muted-foreground">{{ step.detail }}</p>
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
                  Inspect it as an Angular developer
                </h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  Follow the model into the runtime and UI.
                </p>
              </div>
            </div>
            <ol class="mt-9 border-t border-border">
              @for (step of developerSteps; track step.title; let index = $index) {
                <li class="grid grid-cols-[2rem_1fr] gap-4 border-b border-border py-5">
                  <span class="font-mono text-xs text-muted-foreground">{{
                    (index + 1).toString().padStart(2, '0')
                  }}</span>
                  <div>
                    <h3 class="font-semibold">{{ step.title }}</h3>
                    <p class="mt-2 text-sm leading-6 text-muted-foreground">{{ step.detail }}</p>
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
          <p class="forge-section-mark">Shared demo accounts</p>
          <h2 class="mt-5 text-3xl font-semibold tracking-[-0.04em]">
            Use the same CMS the clinic uses.
          </h2>
          <p class="mt-4 max-w-[56ch] leading-7 text-muted-foreground">
            Everyone shares the database. Content may change between visits, and the demo is bounded
            so one visitor cannot make it unusable for the next.
          </p>
          <div class="mt-8 overflow-hidden rounded-xl border border-border bg-background">
            @for (account of credentials; track account.email) {
              <div
                class="grid gap-4 border-b border-border p-5 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <p class="font-semibold">{{ account.role }}</p>
                  <p class="mt-1 break-all font-mono text-sm text-muted-foreground">
                    {{ account.email }} / {{ account.password }}
                  </p>
                </div>
                <button
                  voltButton
                  variant="outline"
                  size="sm"
                  type="button"
                  [attr.aria-label]="'Copy credentials for ' + account.role"
                  (click)="copy(account.email, account.password)"
                >
                  @if (copied() === account.email) {
                    <lmn-check tone="success" [size]="16" />
                    Copied
                  } @else {
                    <lmn-clipboard [size]="16" />
                    Copy
                  }
                </button>
              </div>
            }
          </div>
        </div>

        <aside class="self-start rounded-[1.25rem] bg-[#0A0F1A] p-7 text-white md:p-9">
          <p class="text-sm font-medium text-[#22D3EE]">Read the implementation</p>
          <h2 class="mt-4 text-3xl font-semibold tracking-[-0.04em]">
            The source is part of the demo.
          </h2>
          <p class="mt-4 leading-7 text-white/65">
            The content model, Local API composition and app-side findings are public. The rough
            edges are documented alongside the working paths.
          </p>
          <ul class="mt-7 space-y-3 font-mono text-sm text-white/70">
            <li>server/api/collections.ts</li>
            <li>routes/api/site/home.get.ts</li>
            <li>docs/DEMO-FINDINGS.md</li>
          </ul>
          <a
            voltButton
            variant="outline"
            class="mt-8 border-white/25 bg-white/5 text-white hover:bg-white/10"
            [href]="sourceUrl"
            target="_blank"
            rel="noreferrer"
          >
            Browse the demo source
            <lmn-arrow-top-right-on-square [size]="16" />
          </a>
        </aside>
      </section>

      <forge-cms-footer />
    </main>
  `
})
export class DemoPage {
  protected readonly demoUrl = DEMO_APP_URL;
  protected readonly adminUrl = DEMO_ADMIN_URL;
  protected readonly sourceUrl = DEMO_SOURCE_URL;
  protected readonly credentials = DEMO_CREDENTIALS;
  protected readonly editorSteps = EDITOR_STEPS;
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
