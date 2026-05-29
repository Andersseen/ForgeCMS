import { describe, expect, it } from 'vitest';
import {
  ForgeAdminLayoutComponent,
  ForgeCollectionListComponent,
  ForgeCollectionFormComponent
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
});
