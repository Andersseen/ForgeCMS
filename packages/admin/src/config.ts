import type { CollectionDefinition } from '@forge-cms/core';

/** Icons the sidebar can draw without the host app importing an icon library. */
export type ForgeAdminNavIcon =
  | 'dashboard'
  | 'collections'
  | 'media'
  | 'users'
  | 'api'
  | 'settings';

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
  /** Title shown in the admin panel */
  title?: string;
  /** Logo URL or text */
  logo?: string;
  /** Collections exposed in the admin */
  collections?: CollectionDefinition[];
  /**
   * Sidebar navigation. Omit to keep {@link DEFAULT_ADMIN_NAV}.
   *
   * Before spec 042 the nav was hardcoded, so every consuming app had to implement all six of its
   * destinations or ship dead links — even when the app had no media library or API page, and even
   * when the thing its editors actually open every morning (a booking inbox, an order queue) could
   * not be linked at all.
   */
  nav?: ForgeAdminNavGroup[];
  /** Enable/disable features */
  features?: {
    media?: boolean;
    users?: boolean;
    settings?: boolean;
  };
}

/** What the sidebar renders when a host app does not configure `nav`. */
export const DEFAULT_ADMIN_NAV: ForgeAdminNavGroup[] = [
  {
    label: 'Content',
    items: [
      { label: 'Dashboard', routerLink: '/admin', icon: 'dashboard', exact: true },
      { label: 'Collections', routerLink: '/admin/collections', icon: 'collections' },
      { label: 'Media Library', routerLink: '/admin/media', icon: 'media' }
    ]
  },
  {
    label: 'Users & Access',
    items: [
      { label: 'Users', routerLink: '/admin/users', icon: 'users', adminOnly: true },
      { label: 'API', routerLink: '/admin/api', icon: 'api' }
    ]
  },
  {
    label: 'System',
    items: [{ label: 'Settings', routerLink: '/admin/settings', icon: 'settings' }]
  }
];
