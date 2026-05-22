import { ChangeDetectionStrategy, Component } from '@angular/core';
import { VoltBadge, VoltButton, VoltCard, VoltInput, VoltSeparator } from '@voltui/components';
import {
  IconCode,
  IconCopy,
  IconEye,
  IconKey,
  IconMoreVertical,
  IconPlus,
  IconTrash,
  IconZap
} from '../../../components/icons';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  prefix: string;
  permissions: string[];
  lastUsed: string;
  createdAt: string;
  status: 'active' | 'revoked';
}

@Component({
  selector: 'forge-cms-api',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    VoltBadge,
    VoltInput,
    VoltSeparator,
    IconPlus,
    IconKey,
    IconCode,
    IconEye,
    IconCopy,
    IconTrash,
    IconMoreVertical,
    IconZap
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">API Keys</h1>
          <p class="text-sm text-muted-foreground mt-1">Manage API keys for headless content access.</p>
        </div>
        <volt-button size="sm">
          <icon-plus class="h-3.5 w-3.5 mr-1.5" />
          Generate Key
        </volt-button>
      </div>

      <!-- API Endpoints Card -->
      <volt-card class="p-5">
        <div class="flex items-center gap-3 mb-4">
          <div class="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <icon-code class="h-5 w-5" />
          </div>
          <div>
            <h2 class="font-semibold">API Endpoints</h2>
            <p class="text-xs text-muted-foreground">Use these endpoints to fetch content from your CMS</p>
          </div>
        </div>
        <div class="space-y-3">
          <div class="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div>
              <p class="text-sm font-medium">GraphQL</p>
              <p class="text-xs text-muted-foreground font-mono">/api/graphql</p>
            </div>
            <volt-button variant="ghost" size="sm">Docs</volt-button>
          </div>
          <div class="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div>
              <p class="text-sm font-medium">REST API</p>
              <p class="text-xs text-muted-foreground font-mono">/api/v1/{'{collection}'}</p>
            </div>
            <volt-button variant="ghost" size="sm">Docs</volt-button>
          </div>
          <div class="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div>
              <p class="text-sm font-medium">Webhooks</p>
              <p class="text-xs text-muted-foreground">Trigger events on content changes</p>
            </div>
            <volt-button variant="ghost" size="sm">Configure</volt-button>
          </div>
        </div>
      </volt-card>

      <!-- Keys List -->
      <div class="space-y-4">
        <h2 class="text-lg font-semibold">API Keys</h2>
        @for (apiKey of apiKeys; track apiKey.id) {
          <volt-card class="p-4">
            <div class="flex items-start justify-between">
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <h3 class="font-medium">{{ apiKey.name }}</h3>
                  @if (apiKey.status === 'active') {
                    <volt-badge variant="outline" class="text-success border-success text-[10px]">Active</volt-badge>
                  } @else {
                    <volt-badge variant="outline" class="text-muted-foreground text-[10px]">Revoked</volt-badge>
                  }
                </div>
                <div class="flex items-center gap-2">
                  <code class="text-xs bg-muted px-2 py-1 rounded font-mono">{{ apiKey.prefix }}************************</code>
                  <volt-button variant="ghost" size="icon" class="h-6 w-6">
                    <icon-eye class="h-3 w-3" />
                  </volt-button>
                  <volt-button variant="ghost" size="icon" class="h-6 w-6">
                    <icon-copy class="h-3 w-3" />
                  </volt-button>
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  @for (perm of apiKey.permissions; track perm) {
                    <span class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{{ perm }}</span>
                  }
                </div>
              </div>
              <div class="flex items-center gap-1">
                <volt-button variant="ghost" size="icon" class="h-7 w-7">
                  <icon-trash class="h-3.5 w-3.5" />
                </volt-button>
                <volt-button variant="ghost" size="icon" class="h-7 w-7">
                  <icon-more-vertical class="h-3.5 w-3.5" />
                </volt-button>
              </div>
            </div>
            <volt-separator class="my-3" />
            <div class="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Created {{ apiKey.createdAt }}</span>
              <span>Last used {{ apiKey.lastUsed }}</span>
            </div>
          </volt-card>
        }
      </div>
    </div>
  `
})
export class ApiPage {
  apiKeys: ApiKey[] = [
    {
      id: '1',
      name: 'Production Web App',
      key: 'fcms_live_abcdefghijklmnopqrstuvwxyz',
      prefix: 'fcms_live_',
      permissions: ['read:pages', 'read:posts', 'read:products', 'read:media'],
      lastUsed: '2m ago',
      createdAt: 'Jan 15, 2026',
      status: 'active'
    },
    {
      id: '2',
      name: 'Mobile App (iOS)',
      key: 'fcms_live_zyxwvutsrqponmlkjihgfedcba',
      prefix: 'fcms_live_',
      permissions: ['read:pages', 'read:posts', 'read:products', 'read:media', 'write:forms'],
      lastUsed: '1h ago',
      createdAt: 'Feb 3, 2026',
      status: 'active'
    },
    {
      id: '3',
      name: 'Analytics Integration',
      key: 'fcms_live_analyticsintegrationkey123',
      prefix: 'fcms_live_',
      permissions: ['read:pages', 'read:posts', 'read:users'],
      lastUsed: '5h ago',
      createdAt: 'Mar 12, 2026',
      status: 'active'
    },
    {
      id: '4',
      name: 'Staging Environment',
      key: 'fcms_test_stagingenvironmentkey45678',
      prefix: 'fcms_test_',
      permissions: ['read:*', 'write:*'],
      lastUsed: '1d ago',
      createdAt: 'Apr 1, 2026',
      status: 'revoked'
    }
  ];
}
