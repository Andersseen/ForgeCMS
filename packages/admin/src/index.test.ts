import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import {
  ForgeAdminLayoutComponent,
  ForgeCollectionListComponent,
  ForgeCollectionFormComponent,
  PageHeaderComponent,
  LoadingStateComponent,
  ErrorStateComponent,
  EmptyStateComponent,
  ForgeSignInComponent,
  ForgeSignUpComponent,
  ForgeUsersWorkspaceComponent,
  forgeAdminAuthRoutes,
  ForgeAnalyticsDashboardComponent,
  forgeAdminAnalyticsRoutes
} from './index';

describe('@forge-cms/admin', () => {
  it('exports layout component', () => {
    expect(ForgeAdminLayoutComponent).toBeDefined();
  });

  it('exports collection list component', () => {
    expect(ForgeCollectionListComponent).toBeDefined();
  });

  it('exports collection form component', () => {
    expect(ForgeCollectionFormComponent).toBeDefined();
  });

  it('exports shared presentational components', () => {
    expect(PageHeaderComponent).toBeDefined();
    expect(LoadingStateComponent).toBeDefined();
    expect(ErrorStateComponent).toBeDefined();
    expect(EmptyStateComponent).toBeDefined();
  });

  it('exports the auth experience (spec 054)', () => {
    expect(ForgeSignInComponent).toBeDefined();
    expect(ForgeSignUpComponent).toBeDefined();
    expect(ForgeUsersWorkspaceComponent).toBeDefined();
    expect(forgeAdminAuthRoutes).toBeDefined();
  });

  it('exports Forge Analytics (spec 057, experimental)', () => {
    expect(ForgeAnalyticsDashboardComponent).toBeDefined();
    expect(forgeAdminAnalyticsRoutes).toBeDefined();
  });
});
