import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltButton } from '@voltui/components';
import { DemoDialogService } from './demo-dialog.service';

/**
 * The site header.
 *
 * The nav carries one destination, `/docs`. The old `#architecture`/`#packages`/`#roadmap` entries
 * were anchors into the landing page itself — dead weight in a global header, and broken anywhere
 * but the landing page. The demo and GitHub keep their buttons on the right.
 */
@Component({
  selector: 'forge-cms-header',
  standalone: true,
  imports: [RouterLink, VoltButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mx-auto w-full max-w-7xl px-6 py-5 md:px-8">
      <div class="flex items-center justify-between">
        <a
          class="flex items-center gap-3 text-sm font-semibold text-foreground"
          routerLink="/"
          (click)="close()"
        >
          <img
            class="size-9 rounded-md"
            src="/logo.svg"
            alt="ForgeCMS logo"
            width="36"
            height="36"
          />
          <span>ForgeCMS</span>
        </a>

        <nav class="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
          <a class="transition hover:text-foreground" routerLink="/docs">Docs</a>
        </nav>

        <div class="hidden items-center gap-2 md:flex">
          <volt-button size="sm" (click)="demo.open()">See the demo</volt-button>
          <a href="https://github.com/Andersseen/ForgeCMS" rel="noreferrer" target="_blank">
            <volt-button variant="outline" size="sm">GitHub</volt-button>
          </a>
        </div>

        <button
          type="button"
          class="inline-flex size-10 items-center justify-center rounded-md border border-border text-foreground transition hover:bg-muted md:hidden"
          [attr.aria-expanded]="open()"
          aria-controls="site-mobile-nav"
          aria-label="Toggle navigation"
          (click)="toggle()"
        >
          @if (open()) {
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              class="size-5"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          } @else {
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              class="size-5"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          }
        </button>
      </div>

      @if (open()) {
        <nav
          id="site-mobile-nav"
          class="mt-4 flex flex-col gap-1 rounded-lg border border-border bg-surface p-2 md:hidden"
        >
          <a
            class="rounded-md px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
            routerLink="/docs"
            (click)="close()"
            >Docs</a
          >
          <a
            class="rounded-md px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
            href="https://github.com/Andersseen/ForgeCMS"
            rel="noreferrer"
            target="_blank"
            (click)="close()"
            >GitHub</a
          >
          <div class="p-1">
            <volt-button class="w-full" size="sm" (click)="openDemo()">See the demo</volt-button>
          </div>
        </nav>
      }
    </header>
  `
})
export class HeaderComponent {
  protected readonly demo = inject(DemoDialogService);
  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.update((value) => !value);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected openDemo(): void {
    this.close();
    this.demo.open();
  }
}
