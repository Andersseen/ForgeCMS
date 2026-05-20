import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import {
  VoltAvatar,
  VoltAvatarFallback,
  VoltAvatarImage,
  VoltBadge,
  VoltButton,
  VoltInput,
  VoltSeparator,
  VoltSidebar,
  VoltSidebarContent,
  VoltSidebarFooter,
  VoltSidebarGroup,
  VoltSidebarHeader,
  VoltSidebarItem,
  VoltSidebarService,
} from '@voltui/components';
import {
  IconBarChart,
  IconBell,
  IconChevronRight,
  IconCode,
  IconGlobe,
  IconImage,
  IconLayout,
  IconMenu,
  IconNewspaper,
  IconSearch,
  IconSettings,
  IconShield,
  IconTerminal,
  IconUsers,
  IconZap,
} from '../../components/icons';

interface BreadcrumbItem {
  label: string;
  routerLink?: string;
}

@Component({
  selector: 'forge-cms-admin-layout',
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
    VoltBadge,
    IconLayout,
    IconGlobe,
    IconNewspaper,
    IconImage,
    IconUsers,
    IconZap,
    IconCode,
    IconBarChart,
    IconSettings,
    IconShield,
    IconMenu,
    IconSearch,
    IconChevronRight,
    IconBell,
    IconTerminal,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen flex bg-background">
      <!-- Mobile trigger -->
      <div class="fixed top-4 left-4 z-10 md:hidden">
        <button volt-button variant="outline" size="icon" (click)="sidebarService.toggleMobile()">
          <icon-menu class="h-4 w-4" />
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
                <span class="font-semibold text-sm truncate">ForgeCMS</span>
              }
            </div>
          </div>
        </volt-sidebar-header>

        <volt-sidebar-content>
          <volt-sidebar-group label="Content">
            <volt-sidebar-item
              routerLink="/admin"
              [exact]="true"
              label="Dashboard"
            >
              <icon-bar-chart slot="icon" class="h-4 w-4" />
            </volt-sidebar-item>
            <volt-sidebar-item routerLink="/admin/collections" label="Collections">
              <icon-layout slot="icon" class="h-4 w-4" />
            </volt-sidebar-item>
            <volt-sidebar-item routerLink="/admin/media" label="Media Library">
              <icon-image slot="icon" class="h-4 w-4" />
            </volt-sidebar-item>
          </volt-sidebar-group>

          <div class="px-3 my-2">
            <volt-separator />
          </div>

          <volt-sidebar-group label="Users & Access">
            <volt-sidebar-item routerLink="/admin/users" label="Users">
              <icon-users slot="icon" class="h-4 w-4" />
            </volt-sidebar-item>
            <volt-sidebar-item routerLink="/admin/api" label="API Keys">
              <icon-code slot="icon" class="h-4 w-4" />
            </volt-sidebar-item>
          </volt-sidebar-group>

          <div class="px-3 my-2">
            <volt-separator />
          </div>

          <volt-sidebar-group label="System">
            <volt-sidebar-item routerLink="/admin/settings" label="Settings">
              <icon-settings slot="icon" class="h-4 w-4" />
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
        <div class="h-14 border-b border-border flex items-center justify-between px-4 md:px-6 shrink-0">
          <div class="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
            <button
              volt-button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              (click)="sidebarService.toggleCollapse()"
            >
              <icon-menu class="h-4 w-4" />
            </button>
            <volt-separator orientation="vertical" class="h-4 mx-2" />
            <div class="flex items-center gap-1.5">
              @for (crumb of breadcrumbs(); track $index) {
                @if ($index > 0) {
                  <icon-chevron-right class="h-3.5 w-3.5" />
                }
                @if (crumb.routerLink) {
                  <a [routerLink]="crumb.routerLink" class="hover:text-foreground transition-colors">{{ crumb.label }}</a>
                } @else {
                  <span class="text-foreground font-medium">{{ crumb.label }}</span>
                }
              }
            </div>
          </div>
          <div class="flex items-center gap-2 ml-auto">
            <volt-input placeholder="Search..." class="w-56 h-8 text-xs" />
            <volt-button variant="ghost" size="icon" class="relative">
              <icon-bell class="h-4 w-4" />
              <span class="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"></span>
            </volt-button>
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
  `,
})
export class AdminLayout {
  sidebarService = inject(VoltSidebarService);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);

  private routeChanges = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      startWith(null),
      map(() => this.buildBreadcrumbs())
    ),
    { initialValue: [{ label: 'Dashboard' }] }
  );

  breadcrumbs = computed<BreadcrumbItem[]>(() => this.routeChanges());

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
