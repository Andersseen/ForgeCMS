/** Icons the sidebar can draw without the host app importing an icon library. */
export type ForgeAdminNavIcon =
  | 'dashboard'
  | 'collections'
  | 'media'
  | 'users'
  | 'api'
  | 'settings'
  | 'analytics';

export interface ForgeAdminNavItem {
  label: string;
  /** Router link, e.g. `/admin/collections/bookings`. */
  routerLink: string;
  icon?: ForgeAdminNavIcon;
  /** Match the link exactly — use it for the index route. */
  exact?: boolean;
  /** Only show this item to admins. */
  adminOnly?: boolean;
}

export interface ForgeAdminNavGroup {
  label?: string;
  items: ForgeAdminNavItem[];
}

export interface ForgeAdminConfig {
  /** Title shown in the sidebar header. Defaults to `ForgeCMS`. */
  title?: string;
  /**
   * Where the admin is mounted in the host app (spec 087): a same-app absolute path such as
   * `/admin` (the default), `/studio` or `/ops/cms`. It roots the breadcrumbs, the built-in default
   * navigation and the default sign-in path (`{basePath}/login`). Pass the same value to
   * `forgeAdminAuthRoutes({ basePath })` so the sign-in/up pages return inside it. An invalid value
   * (a URL, `//host`, `..`, …) is ignored in favour of `/admin`.
   */
  basePath?: string;
  /**
   * @deprecated No runtime effect — never rendered. Kept so existing configs still compile; it is
   * not part of the 1.0 guarantee and will be removed after 1.0.
   */
  logo?: string;
  /**
   * Restricts and orders the collections shown on the content index to these slugs. Only `slug` is
   * read, so a browser app can pass `{ slug: 'posts' }` objects instead of importing server schema
   * (a full `CollectionDefinition` still type-checks).
   */
  collections?: ReadonlyArray<{ readonly slug: string }>;
  /**
   * Sidebar navigation. Omit to keep {@link DEFAULT_ADMIN_NAV}.
   *
   * Before spec 042 the nav was hardcoded, so every consuming app had to implement all six of its
   * destinations or ship dead links — even when the app had no media library or API page, and even
   * when the thing its editors actually open every morning (a booking inbox, an order queue) could
   * not be linked at all.
   */
  nav?: ForgeAdminNavGroup[];
  /**
   * @deprecated No runtime effect — nothing reads these flags. Kept so existing configs still
   * compile; not part of the 1.0 guarantee. Control visibility with `nav` and route guards.
   */
  features?: {
    media?: boolean;
    users?: boolean;
    settings?: boolean;
  };
  /**
   * Where the layout's "Log in" link and post-logout redirect go. Defaults to `{basePath}/login` (`/admin/login`), matching
   * `forgeAdminAuthRoutes()`'s own convention (spec 054) — set this if a host mounts sign-in somewhere
   * else instead (e.g. a top-level `/login` predating that helper).
   */
  signInPath?: string;
}

/**
 * The built-in navigation for an admin mounted at `basePath`: only destinations the package itself
 * ships routes for (`forgeAdminContentRoutes()` and `ForgeUsersWorkspaceComponent`). Dashboards,
 * media, API and settings pages are the host's own — add them through `nav` (spec 087).
 */
export function adminNavFor(basePath: string): ForgeAdminNavGroup[] {
  return [
    {
      label: 'Content',
      items: [{ label: 'Collections', routerLink: `${basePath}/collections`, icon: 'collections' }]
    },
    {
      label: 'Users & Access',
      items: [{ label: 'Users', routerLink: `${basePath}/users`, icon: 'users', adminOnly: true }]
    }
  ];
}

/** What the sidebar renders at the default `/admin` mount when a host app does not configure `nav`. */
export const DEFAULT_ADMIN_NAV: ForgeAdminNavGroup[] = adminNavFor('/admin');
