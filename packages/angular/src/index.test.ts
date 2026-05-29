import { describe, expect, it } from 'vitest';
import { CmsApiService, FORGE_CMS_CONFIG } from './index';

describe('@forge-cms/angular', () => {
  it('exports CmsApiService', () => {
    expect(CmsApiService).toBeDefined();
  });

  it('exports FORGE_CMS_CONFIG token', () => {
    expect(FORGE_CMS_CONFIG).toBeDefined();
  });
});
