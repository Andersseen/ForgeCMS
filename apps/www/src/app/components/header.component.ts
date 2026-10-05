import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import type { ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowTopRightOnSquareIcon } from 'lumen-icons/arrow-top-right-on-square';
import { LmnBars3Icon } from 'lumen-icons/bars-3';
import { SiteThemeService } from '../site-theme.service';
import { LmnSunIcon } from 'lumen-icons/sun';
import { LmnMoonIcon } from 'lumen-icons/moon';
import { LmnXMarkIcon } from 'lumen-icons/x-mark';

@Component({
  selector: 'forge-cms-header',
  standalone: true,
  imports: [
    RouterLink,
    VoltNativeButton,
    LmnArrowTopRightOnSquareIcon,
    LmnBars3Icon,
    LmnXMarkIcon,
    LmnSunIcon,
    LmnMoonIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header
      class="forge-header sticky top-0 z-40 border-b border-border/70 bg-background/88"
      (keydown.escape)="dismiss()"
    >
      <div class="mx-auto flex min-h-18 w-full max-w-7xl items-center justify-between px-5 md:px-8">
        <a
          class="group flex items-center gap-3 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
          routerLink="/"
          (click)="close()"
        >
          <img
            class="size-9 rounded-[0.65rem] transition-transform group-hover:-rotate-2"
            src="/logo.svg"
            alt="ForgeCMS logo"
            width="36"
            height="36"
          />
          <span class="text-[0.95rem] tracking-[-0.02em]">ForgeCMS</span>
        </a>

        <nav class="hidden items-center gap-1 text-sm font-medium md:flex" aria-label="Primary">
          <a class="forge-nav-link" routerLink="/" fragment="product">Product</a>
          <a class="forge-nav-link" routerLink="/demo">Demo</a>
          <a class="forge-nav-link" routerLink="/docs">Docs</a>
        </nav>

        <div class="hidden items-center gap-3 md:flex">
          <a
            voltButton
            variant="outline"
            size="sm"
            href="https://github.com/Andersseen/ForgeCMS"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
            <lmn-arrow-top-right-on-square [size]="16" ariaLabel="Opens in a new tab" />
          </a>
          <a voltButton size="sm" routerLink="/docs/small-project-guide">Get started</a>
        </div>

        <button
          voltButton
          variant="ghost"
          size="icon"
          type="button"
          class="forge-theme-toggle"
          [attr.aria-label]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
          (click)="theme.toggle()"
        >
          @if (theme.isDark()) {
            <lmn-sun [size]="20" />
          } @else {
            <lmn-moon [size]="20" />
          }
        </button>

        <button
          #menuTrigger
          voltButton
          variant="ghost"
          size="icon"
          type="button"
          class="md:hidden"
          [attr.aria-expanded]="open()"
          aria-controls="site-mobile-nav"
          aria-label="Toggle navigation"
          (click)="toggle()"
        >
          @if (open()) {
            <lmn-x-mark [size]="20" />
          } @else {
            <lmn-bars-3 [size]="20" />
          }
        </button>
      </div>

      @if (open()) {
        <nav
          id="site-mobile-nav"
          class="border-t border-border bg-background px-5 py-4 md:hidden"
          aria-label="Mobile"
        >
          <div class="mx-auto flex max-w-7xl flex-col gap-1">
            <a class="forge-mobile-link" routerLink="/" fragment="product" (click)="close()"
              >Product</a
            >
            <a class="forge-mobile-link" routerLink="/demo" (click)="close()">Demo</a>
            <a class="forge-mobile-link" routerLink="/docs" (click)="close()">Docs</a>
            <a
              class="forge-mobile-link flex items-center justify-between"
              href="https://github.com/Andersseen/ForgeCMS"
              rel="noreferrer"
              target="_blank"
              (click)="close()"
            >
              GitHub
              <lmn-arrow-top-right-on-square [size]="16" />
            </a>
          </div>
        </nav>
      }
    </header>
  `
})
export class HeaderComponent {
  protected readonly theme = inject(SiteThemeService);
  protected readonly open = signal(false);
  private readonly menuTrigger = viewChild<ElementRef<HTMLButtonElement>>('menuTrigger');

  protected dismiss(): void {
    if (!this.open()) return;
    this.close();
    this.menuTrigger()?.nativeElement.focus();
  }

  protected toggle(): void {
    this.open.update((value) => !value);
  }

  protected close(): void {
    this.open.set(false);
  }
}
