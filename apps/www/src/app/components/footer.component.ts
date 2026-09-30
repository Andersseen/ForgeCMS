import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';

@Component({
  selector: 'forge-cms-footer',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="border-t border-border bg-background px-5 py-16 md:px-8 md:py-20">
      <div
        class="mx-auto flex w-full max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center"
      >
        <div>
          <h2
            class="max-w-[16ch] text-3xl font-semibold leading-tight tracking-[-0.04em] md:text-4xl"
          >
            Read the model. Then change it live.
          </h2>
          <p class="mt-3 max-w-xl leading-7 text-muted-foreground">
            The documentation explains the contracts; the Lumea clinic shows what they feel like in
            a real Angular application.
          </p>
        </div>
        <div class="flex flex-col gap-3 sm:flex-row">
          <a voltButton size="lg" routerLink="/demo">
            Explore the demo
            <lmn-arrow-right [size]="16" />
          </a>
          <a voltButton variant="outline" size="lg" routerLink="/docs">Read the docs</a>
        </div>
      </div>
    </section>

    <footer class="border-t border-border bg-background px-5 py-9 md:px-8">
      <div
        class="mx-auto flex w-full max-w-7xl flex-col gap-7 md:flex-row md:items-center md:justify-between"
      >
        <a class="inline-flex items-center gap-3 font-semibold text-foreground" routerLink="/">
          <img class="size-8 rounded-md" src="/logo.svg" alt="" width="32" height="32" />
          <span>ForgeCMS</span>
        </a>
        <nav class="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
          <a class="forge-footer-link" routerLink="/">Product</a>
          <a class="forge-footer-link" routerLink="/demo">Demo</a>
          <a class="forge-footer-link" routerLink="/docs">Docs</a>
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
        <p class="text-xs text-muted-foreground">MIT · experimental pre-1.0</p>
      </div>
    </footer>
  `
})
export class FooterComponent {}
