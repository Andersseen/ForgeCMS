import { describe, expect, it } from 'vitest';
import { routes } from '../app/app.routes';

interface DemoNavItem {
  label: string;
  routerLink: string;
  exact?: boolean;
}

interface DemoNavGroup {
  items: DemoNavItem[];
}

function navItem(label: string): DemoNavItem | undefined {
  const adminRoute = routes.find((route) => route.path === 'admin');
  const config = adminRoute?.data?.['config'] as { nav?: DemoNavGroup[] } | undefined;
  return config?.nav?.flatMap((group) => group.items).find((item) => item.label === label);
}

describe('demo admin navigation', () => {
  it('keeps collection index highlighting exact', () => {
    expect(navItem('All collections')).toMatchObject({
      routerLink: '/admin/collections',
      exact: true
    });
  });

  it('treats singleton admin pages as exact routes', () => {
    expect(navItem('Clinic settings')).toMatchObject({
      routerLink: '/admin/settings',
      exact: true
    });
  });
});
