import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltButton } from '@voltui/components';

@Component({
  selector: 'forge-cms-header',
  standalone: true,
  imports: [VoltButton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5 md:px-8">
      <a class="flex items-center gap-3 text-sm font-semibold text-foreground" href="#">
        <img class="size-9 rounded-md" src="/logo.svg" alt="ForgeCMS logo" width="36" height="36" />
        <span>ForgeCMS</span>
      </a>

      <nav class="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
        <a class="transition hover:text-foreground" href="#architecture">Architecture</a>
        <a class="transition hover:text-foreground" href="#packages">Packages</a>
        <a class="transition hover:text-foreground" href="#roadmap">Roadmap</a>
      </nav>

      <div class="flex items-center gap-2">
        <a routerLink="/admin">
          <volt-button variant="default" size="sm">Dashboard</volt-button>
        </a>
        <a href="https://github.com/forge-cms/forge-cms" rel="noreferrer" target="_blank">
          <volt-button variant="outline" size="sm">GitHub</volt-button>
        </a>
      </div>
    </header>
  `
})
export class HeaderComponent {}
