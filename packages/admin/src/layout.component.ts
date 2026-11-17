import { DOCUMENT } from '@angular/common';
import type { ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  viewChild
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, skip, startWith } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ForgeAuthSession, canManageUsers, userRole } from '@forge-cms/angular';
import {
  VoltAvatar,
  VoltAvatarFallback,
  VoltButton,
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
import { adminNavFor } from './config.js';
import type { ForgeAdminConfig, ForgeAdminNavGroup, ForgeAdminNavItem } from './config.js';
import { isUnderPath, normalizeAdminBasePath } from './mount-path.js';
import { ForgeMainLandmarkDirective } from './main-landmark.directive.js';
import { ThemeService } from './theme.service.js';

interface BreadcrumbItem {
  label: string;
  routerLink?: string;
}

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
    VoltAvatarFallback,
    VoltSeparator,
    VoltButton,
    LmnSquares2x2Icon,
    LmnPhotoIcon,
    LmnUsersIcon,
    LmnCodeBracketIcon,
    LmnChartBarIcon,
    LmnCogIcon,
    LmnBars3Icon,
    LmnChevronRightIcon,
    LmnSunIcon,
    LmnMoonIcon,
    ForgeMainLandmarkDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Spec 104: the skip link is styled here, not with utility classes, so it works in any host.
  styles: `
    .forge-admin-skip-link {
      position: absolute;
      left: 0.5rem;
      top: 0.5rem;
      z-index: 100;
      transform: translateY(-200%);
      padding: 0.5rem 0.75rem;
      border-radius: 0.375rem;
      background: var(--background, #fff);
      color: var(--foreground, #000);
      outline: 2px solid currentColor;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .forge-admin-skip-link:focus {
      transform: none;
    }
  `,
  template: `
    <a class="forge-admin-skip-link" [attr.href]="'#' + mainId" (click)="skipToMain($event)"
      >Skip to main content</a
    >
    <div class="h-dvh flex bg-background overflow-hidden">
      <!-- Mobile trigger -->
      <div class="fixed top-4 left-4 z-10 md:hidden">
        <button
          volt-button
          variant="outline"
          size="icon"
          aria-label="Open navigation"
          (click)="sidebarService.toggleMobile()"
        >
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
          <nav aria-label="Admin">
            @for (group of navGroups(); track $index) {
              @if (visibleItems(group).length > 0) {
                @if (!$first) {
                  <div class="px-3 my-2">
                    <volt-separator />
                  </div>
                }
                <volt-sidebar-group [label]="group.label ?? ''">
                  @for (item of visibleItems(group); track item.routerLink) {
                    <!-- tabindex="-1": [routerLink] here also matches Angular's RouterLink (imported
                         for the breadcrumbs), which would make this host a second, empty Tab stop next
                         to Volt's own inner <a>. An explicit tabindex stops RouterLink adding one (spec 104). -->
                    <volt-sidebar-item
                      tabindex="-1"
                      [routerLink]="item.routerLink"
                      [exact]="item.exact ?? false"
                      [label]="item.label"
                    >
                      @switch (item.icon) {
                        @case ('collections') {
                          <lmn-squares-2x2 slot="icon" [size]="16" />
                        }
                        @case ('media') {
                          <lmn-photo slot="icon" [size]="16" />
                        }
                        @case ('users') {
                          <lmn-users slot="icon" [size]="16" />
                        }
                        @case ('api') {
                          <lmn-code-bracket slot="icon" [size]="16" />
                        }
                        @case ('settings') {
                          <lmn-cog slot="icon" [size]="16" />
                        }
                        @case ('analytics') {
                          <lmn-chart-bar slot="icon" [size]="16" />
                        }
                        @default {
                          <lmn-chart-bar slot="icon" [size]="16" />
                        }
                      }
                    </volt-sidebar-item>
                  }
                </volt-sidebar-group>
              }
            }
          </nav>
        </volt-sidebar-content>

        <volt-sidebar-footer>
          <div class="flex items-center gap-3">
            <volt-avatar>
              <volt-avatar-fallback>{{ userInitials() }}</volt-avatar-fallback>
            </volt-avatar>
            @if (!sidebarService.isCollapsed()) {
              <div class="flex flex-col truncate">
                <span class="text-sm font-medium">{{ currentUser()?.name ?? 'Admin User' }}</span>
                <span class="text-xs text-muted-foreground">
                  {{ currentUser()?.email ?? 'admin@forgecms.dev' }} · {{ currentUserRole() }}
                </span>
              </div>
            }
          </div>
        </volt-sidebar-footer>
      </volt-sidebar>

      <!-- Main Content -->
      <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
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
              aria-label="Toggle sidebar"
              (click)="sidebarService.toggleCollapse()"
            >
              <lmn-bars-3 [size]="16" />
            </button>
            <volt-separator orientation="vertical" class="h-4 mx-2" />
            <nav aria-label="Breadcrumb">
              <ol class="flex items-center gap-1.5">
                @for (crumb of breadcrumbs(); track $index) {
                  <li class="flex items-center gap-1.5">
                    @if ($index > 0) {
                      <lmn-chevron-right [size]="14" aria-hidden="true" />
                    }
                    @if (crumb.routerLink) {
                      <a
                        [routerLink]="crumb.routerLink"
                        class="hover:text-foreground transition-colors"
                        >{{ crumb.label }}</a
                      >
                    } @else {
                      <span class="text-foreground font-medium" aria-current="page">{{
                        crumb.label
                      }}</span>
                    }
                  </li>
                }
              </ol>
            </nav>
          </div>
          <div class="flex items-center gap-2 ml-auto">
            <!-- Named by visually hidden text: the pinned Volt 1.0.x keeps an aria-label on the
                 <volt-button> host, where it names nothing. -->
            <volt-button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              (click)="themeService.toggle()"
            >
              @if (themeService.isDark()) {
                <lmn-sun [size]="16" />
              } @else {
                <lmn-moon [size]="16" />
              }
              <span class="sr-only">{{
                themeService.isDark() ? 'Switch to light mode' : 'Switch to dark mode'
              }}</span>
            </volt-button>
            @if (session.authenticated()) {
              <volt-button variant="ghost" size="sm" (click)="logout()">Log out</volt-button>
            } @else {
              <!-- One element, one tab stop (spec 104): a link styled as a ghost button, not a link
                   wrapping a <volt-button> (which renders a second focusable <button>). -->
              <a [routerLink]="signInPath()" [class]="headerLinkClass">Log in</a>
            }
            <a routerLink="/" [class]="headerLinkClass">Exit</a>
          </div>
        </div>

        <!-- Page Content: the main landmark and the skip link's target (spec 104) -->
        <div
          #main
          forgeMainLandmark
          [id]="mainId"
          tabindex="-1"
          class="flex-1 min-h-0 overflow-y-auto p-6 focus:outline-none"
        >
          <router-outlet />
        </div>
      </div>
    </div>
  `
})
export class ForgeAdminLayoutComponent {
  readonly config = input<ForgeAdminConfig>();

  /** Configured navigation, or the built-in default. */
  protected readonly navGroups = computed<ForgeAdminNavGroup[]>(
    () => this.config()?.nav ?? adminNavFor(this.basePath())
  );

  /** The mount root — see `ForgeAdminConfig.basePath`. */
  protected readonly basePath = computed(() => normalizeAdminBasePath(this.config()?.basePath));

  /** Where "Log in" and post-logout redirect go — see `ForgeAdminConfig.signInPath`. */
  protected readonly signInPath = computed(
    () => this.config()?.signInPath ?? `${this.basePath()}/login`
  );

  /** Hides admin-only entries from editors and viewers. */
  protected visibleItems(group: ForgeAdminNavGroup): ForgeAdminNavItem[] {
    const isAdmin = canManageUsers(this.session.user());
    return group.items.filter((item) => item.adminOnly !== true || isAdmin);
  }

  /** The id of the main region; the skip link's target. */
  protected readonly mainId = 'forge-admin-main';
  protected readonly headerLinkClass =
    'inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2';
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  sidebarService = inject(VoltSidebarService);
  themeService = inject(ThemeService);
  private router = inject(Router);
  protected readonly session = inject(ForgeAuthSession);

  readonly currentUser = this.session.user;
  readonly currentUserRole = computed(() => userRole(this.currentUser()));
  readonly userInitials = computed(() => {
    const name = this.currentUser()?.name ?? '';
    const email = this.currentUser()?.email ?? '';
    const source = name || email || 'U';
    return source
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  });

  protected readonly canManageUsers = canManageUsers;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  breadcrumbs = computed<BreadcrumbItem[]>(() => this.buildBreadcrumbs(this.url()));

  constructor() {
    // Spec 104: after an in-shell navigation, focus that was on a now-removed element (or nowhere)
    // lands on the main region instead of falling back to <body> — so the next Tab continues in the
    // new page, and screen readers hear where they are. Focus a page put somewhere itself is kept.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        skip(1),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        afterNextRender(
          () => {
            const active = this.doc.activeElement;
            if (active === null || active === this.doc.body || !active.isConnected) {
              this.main().nativeElement.focus({ preventScroll: true });
            }
          },
          { injector: this.injector }
        );
      });
  }

  /**
   * Moves focus to the main region. A plain `#id` link would resolve against `<base href>` and leave
   * the admin (a full navigation to `/#…`), so the default is prevented.
   */
  protected skipToMain(event: Event): void {
    event.preventDefault();
    const main = this.main().nativeElement;
    main.focus();
    main.scrollIntoView?.({ block: 'start' });
  }

  /** Clears the session (server cookie + local state) and returns to sign-in. */
  protected async logout(): Promise<void> {
    await this.session.logout();
    await this.router.navigateByUrl(this.signInPath());
  }

  private buildBreadcrumbs(url: string): BreadcrumbItem[] {
    const base = this.basePath();
    const crumbs: BreadcrumbItem[] = [{ label: 'Admin', routerLink: base }];
    const pathname = url.split(/[?#]/, 1)[0] ?? url;

    if (pathname === base || pathname === `${base}/`) {
      crumbs.push({ label: 'Dashboard' });
      return crumbs;
    }

    const sections: Array<[string, string]> = [
      ['collections', 'Collections'],
      ['media', 'Media Library'],
      ['users', 'Users'],
      ['api', 'API Keys'],
      ['settings', 'Settings']
    ];
    for (const [segment, label] of sections) {
      const target = `${base}/${segment}`;
      if (isUnderPath(pathname, target)) {
        crumbs.push({ label, routerLink: target });
        break;
      }
    }
    return crumbs;
  }
}
