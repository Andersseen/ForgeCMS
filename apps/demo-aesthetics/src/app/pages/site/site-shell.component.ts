import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { applyVoltTheme } from '@voltui/components';
import { SiteApiService } from '../../services/site-api.service';
import { asyncState } from './async-state';

/**
 * Chrome for the public site. The clinic name, contact details and opening hours in the header and
 * footer are CMS content too — nothing here is hardcoded except the navigation labels.
 */
@Component({
  selector: 'lumea-site-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen flex-col">
      <header class="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div class="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4">
          <a routerLink="/" class="flex flex-col leading-tight">
            <span class="lumea-display text-lg font-semibold tracking-tight">
              {{ settings.data()?.clinicName ?? 'Lumea Aesthetics' }}
            </span>
            <span class="text-xs text-muted-foreground">
              {{ settings.data()?.tagline ?? 'Skin and body clinic' }}
            </span>
          </a>

          <nav class="hidden items-center gap-7 text-sm md:flex">
            @for (item of navigation; track item.path) {
              <a
                [routerLink]="item.path"
                routerLinkActive="text-foreground"
                [routerLinkActiveOptions]="{ exact: item.path === '/' }"
                class="text-muted-foreground transition-colors hover:text-foreground"
              >
                {{ item.label }}
              </a>
            }
          </nav>

          <div class="flex items-center gap-3">
            @if (settings.data(); as site) {
              <a
                [href]="'tel:' + site.phone"
                class="hidden text-sm text-muted-foreground hover:text-foreground lg:block"
              >
                {{ site.phone }}
              </a>
            }
            <details class="relative md:hidden">
              <summary
                class="flex h-9 cursor-pointer list-none items-center rounded-full border border-border px-4 text-sm font-medium marker:hidden"
              >
                Menu
              </summary>
              <nav
                class="absolute right-0 top-11 z-30 flex min-w-44 flex-col rounded-xl border border-border bg-background p-2 shadow-lg"
                aria-label="Mobile navigation"
              >
                @for (item of navigation; track item.path) {
                  <a
                    [routerLink]="item.path"
                    routerLinkActive="bg-muted text-foreground"
                    [routerLinkActiveOptions]="{ exact: item.path === '/' }"
                    class="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {{ item.label }}
                  </a>
                }
              </nav>
            </details>
            <a
              routerLink="/booking"
              class="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Book
            </a>
          </div>
        </div>
      </header>

      <main class="flex-1">
        <router-outlet />
      </main>

      <footer class="border-t border-border/60 lumea-band">
        <div class="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-4">
          <div class="md:col-span-2">
            <p class="lumea-display text-xl">{{ settings.data()?.clinicName }}</p>
            <p class="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              {{ settings.data()?.about }}
            </p>
            @if (settings.data(); as site) {
              <p class="mt-5 text-sm text-muted-foreground">
                {{ site.address.street }}, {{ site.address.postalCode }} {{ site.address.city
                }}<br />
                <a class="hover:text-foreground" [href]="'mailto:' + site.email">{{
                  site.email
                }}</a>
                · <a class="hover:text-foreground" [href]="'tel:' + site.phone">{{ site.phone }}</a>
              </p>
            }
          </div>

          <div>
            <p class="text-sm font-medium">Opening hours</p>
            <ul class="mt-3 space-y-1 text-sm text-muted-foreground">
              @for (day of settings.data()?.openingHours ?? []; track day.day) {
                <li class="flex justify-between gap-4">
                  <span>{{ day.day }}</span>
                  <span>{{ day.closed ? 'Closed' : day.opens + '–' + day.closes }}</span>
                </li>
              }
            </ul>
          </div>

          <div>
            <p class="text-sm font-medium">Explore</p>
            <ul class="mt-3 space-y-1 text-sm text-muted-foreground">
              @for (item of navigation; track item.path) {
                <li>
                  <a class="hover:text-foreground" [routerLink]="item.path">{{ item.label }}</a>
                </li>
              }
              <li>
                <a class="hover:text-foreground" routerLink="/booking">Book an appointment</a>
              </li>
            </ul>
          </div>
        </div>

        <div class="border-t border-border/60">
          <div
            class="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
          >
            <span> Lumea Aesthetics is a fictional clinic showcase powered by ForgeCMS. </span>
            <a class="font-medium hover:text-foreground" routerLink="/admin">Staff sign in</a>
          </div>
        </div>
      </footer>
    </div>
  `
})
export class SiteShell {
  private readonly api = inject(SiteApiService);

  constructor() {
    if (typeof window !== 'undefined') {
      applyVoltTheme({ dark: false });
    }
  }

  protected readonly navigation = [
    { path: '/', label: 'Home' },
    { path: '/services', label: 'Treatments' },
    { path: '/team', label: 'Team' },
    { path: '/journal', label: 'Journal' }
  ];

  protected readonly settings = asyncState(() => this.api.settings());
}
