import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import {
  VoltAvatar,
  VoltAvatarFallback,
  VoltAvatarImage,
  VoltButton,
  VoltInput,
  VoltSeparator,
  VoltSidebar,
  VoltSidebarContent,
  VoltSidebarFooter,
  VoltSidebarGroup,
  VoltSidebarHeader,
  VoltSidebarItem,
  VoltSidebarService
} from '@voltui/components';
import {
  LmnBars3Icon,
  LmnBellIcon,
  LmnChartBarIcon,
  LmnChevronRightIcon,
  LmnCodeBracketIcon,
  LmnMoonIcon,
  LmnCogIcon,
  LmnPhotoIcon,
  LmnSquares2x2Icon,
  LmnSunIcon,
  LmnUsersIcon
} from 'lumen-icons';
import type { ForgeAdminConfig } from './config.js';
import { ThemeService } from './theme.service.js';

interface BreadcrumbItem {
  label: string;
  routerLink?: string;
}

const AUTH_TOKEN_KEY = 'forge-auth-token';

@Component({
  selector: 'forge-admin-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    VoltSidebar,
    VoltSidebarContent,
    VoltSidebarFooter,
    VoltSidebarGroup,
    VoltSidebarHeader,
    VoltSidebarItem,
    VoltAvatar,
    VoltAvatarImage,
    VoltAvatarFallback,
    VoltSeparator,
    VoltButton,
    VoltInput,
    LmnSquares2x2Icon,
    LmnPhotoIcon,
    LmnUsersIcon,
    LmnCodeBracketIcon,
    LmnChartBarIcon,
    LmnCogIcon,
    LmnBars3Icon,
    LmnChevronRightIcon,
    LmnBellIcon,
    LmnSunIcon,
    LmnMoonIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen flex bg-background">
      <!-- Mobile trigger -->
      <div class="fixed top-4 left-4 z-10 md:hidden">
        <button volt-button variant="outline" size="icon" (click)="sidebarService.toggleMobile()">
          <lmn-bars-3 [size]="16" />
        </button>
      </div>

      <!-- Sidebar -->
      <volt-sidebar>
        <volt-sidebar-header>
          <div class="flex items-center w-full justify-between gap-2 h-full">
            <div class="flex items-center gap-2 overflow-hidden">
              <div
                class="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shrink-0"
              >
                F
              </div>
              @if (!sidebarService.isCollapsed()) {
                <span class="font-semibold text-sm truncate">{{
                  config()?.title ?? 'ForgeCMS'
                }}</span>
              }
            </div>
          </div>
        </volt-sidebar-header>

        <volt-sidebar-content>
          <volt-sidebar-group label="Content">
            <volt-sidebar-item routerLink="/admin" [exact]="true" label="Dashboard">
              <lmn-chart-bar slot="icon" [size]="16" />
            </volt-sidebar-item>
            <volt-sidebar-item routerLink="/admin/collections" label="Collections">
              <lmn-squares-2x2 slot="icon" [size]="16" />
            </volt-sidebar-item>
            <volt-sidebar-item routerLink="/admin/media" label="Media Library">
              <lmn-photo slot="icon" [size]="16" />
            </volt-sidebar-item>
          </volt-sidebar-group>

          <div class="px-3 my-2">
            <volt-separator />
          </div>

          <volt-sidebar-group label="Users & Access">
            <volt-sidebar-item routerLink="/admin/users" label="Users">
              <lmn-users slot="icon" [size]="16" />
            </volt-sidebar-item>
            <volt-sidebar-item routerLink="/admin/api" label="API Keys">
              <lmn-code-bracket slot="icon" [size]="16" />
            </volt-sidebar-item>
          </volt-sidebar-group>

          <div class="px-3 my-2">
            <volt-separator />
          </div>

          <volt-sidebar-group label="System">
            <volt-sidebar-item routerLink="/admin/settings" label="Settings">
              <lmn-cog slot="icon" [size]="16" />
            </volt-sidebar-item>
          </volt-sidebar-group>
        </volt-sidebar-content>

        <volt-sidebar-footer>
          <div class="flex items-center gap-3">
            <volt-avatar>
              <img voltAvatarImage src="https://i.pravatar.cc/150?u=admin" alt="Admin" />
              <volt-avatar-fallback>AD</volt-avatar-fallback>
            </volt-avatar>
            @if (!sidebarService.isCollapsed()) {
              <div class="flex flex-col truncate">
                <span class="text-sm font-medium">Admin User</span>
                <span class="text-xs text-muted-foreground">admin&#64;forgecms.dev</span>
              </div>
            }
          </div>
        </volt-sidebar-footer>
      </volt-sidebar>

      <!-- Main Content -->
      <div class="flex-1 overflow-auto min-w-0 flex flex-col">
        <!-- Header -->
        <div
          class="h-14 border-b border-border flex items-center justify-between px-4 md:px-6 shrink-0"
        >
          <div class="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
            <button
              volt-button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              (click)="sidebarService.toggleCollapse()"
            >
              <lmn-bars-3 [size]="16" />
            </button>
            <volt-separator orientation="vertical" class="h-4 mx-2" />
            <div class="flex items-center gap-1.5">
              @for (crumb of breadcrumbs(); track $index) {
                @if ($index > 0) {
                  <lmn-chevron-right [size]="14" />
                }
                @if (crumb.routerLink) {
                  <a
                    [routerLink]="crumb.routerLink"
                    class="hover:text-foreground transition-colors"
                    >{{ crumb.label }}</a
                  >
                } @else {
                  <span class="text-foreground font-medium">{{ crumb.label }}</span>
                }
              }
            </div>
          </div>
          <div class="flex items-center gap-2 ml-auto">
            <volt-input placeholder="Search..." class="w-56 h-8 text-xs" />
            <volt-button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              (click)="themeService.toggle()"
              [attr.aria-label]="
                themeService.isDark() ? 'Switch to light mode' : 'Switch to dark mode'
              "
            >
              @if (themeService.isDark()) {
                <lmn-sun [size]="16" />
              } @else {
                <lmn-moon [size]="16" />
              }
            </volt-button>
            <volt-button variant="ghost" size="icon" class="relative">
              <lmn-bell [size]="16" />
              <span
                class="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
              ></span>
            </volt-button>
            @if (isLoggedIn()) {
              <volt-button variant="ghost" size="sm" (click)="logout()">Log out</volt-button>
            } @else {
              <a routerLink="/login">
                <volt-button variant="ghost" size="sm">Log in</volt-button>
              </a>
            }
            <a routerLink="/">
              <volt-button variant="ghost" size="sm">Exit</volt-button>
            </a>
          </div>
        </div>

        <!-- Page Content -->
        <div class="flex-1 p-6">
          <router-outlet />
        </div>
      </div>
    </div>
  `
})
export class ForgeAdminLayoutComponent {
  readonly config = input<ForgeAdminConfig>();

  sidebarService = inject(VoltSidebarService);
  themeService = inject(ThemeService);
  private router = inject(Router);

  private routeChanges = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      startWith(null),
      map((): BreadcrumbItem[] => this.buildBreadcrumbs())
    ),
    { initialValue: [{ label: 'Dashboard' }] as BreadcrumbItem[] }
  );

  breadcrumbs = computed<BreadcrumbItem[]>(() => this.routeChanges());

  protected isLoggedIn(): boolean {
    return localStorage.getItem(AUTH_TOKEN_KEY) !== null;
  }

  protected logout(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    window.location.reload();
  }

  private buildBreadcrumbs(): BreadcrumbItem[] {
    const crumbs: BreadcrumbItem[] = [{ label: 'Admin', routerLink: '/admin' }];
    const url = this.router.url;

    if (url === '/admin') {
      crumbs.push({ label: 'Dashboard' });
    } else if (url.startsWith('/admin/collections')) {
      crumbs.push({ label: 'Collections', routerLink: '/admin/collections' });
    } else if (url.startsWith('/admin/media')) {
      crumbs.push({ label: 'Media Library', routerLink: '/admin/media' });
    } else if (url.startsWith('/admin/users')) {
      crumbs.push({ label: 'Users', routerLink: '/admin/users' });
    } else if (url.startsWith('/admin/api')) {
      crumbs.push({ label: 'API Keys', routerLink: '/admin/api' });
    } else if (url.startsWith('/admin/settings')) {
      crumbs.push({ label: 'Settings', routerLink: '/admin/settings' });
    }

    return crumbs;
  }
}
