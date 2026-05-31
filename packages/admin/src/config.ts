import type { CollectionDefinition } from '@forge-cms/core';

export interface ForgeAdminConfig {
  /** Title shown in the admin panel */
  title?: string;
  /** Logo URL or text */
  logo?: string;
  /** Collections exposed in the admin */
  collections?: CollectionDefinition[];
  /** Enable/disable features */
  features?: {
    media?: boolean;
    users?: boolean;
    settings?: boolean;
  };
}
