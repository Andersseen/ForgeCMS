import { ChangeDetectionStrategy, Component } from '@angular/core';
import { VoltButton, VoltCard } from '@voltui/components';
import {
  IconCode,
  IconKey,
  IconPlus
} from '../../../components/icons';

@Component({
  selector: 'forge-cms-api',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    IconPlus,
    IconKey,
    IconCode
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">API Keys</h1>
          <p class="text-sm text-muted-foreground mt-1">Manage API keys for headless content access.</p>
        </div>
        <volt-button size="sm" disabled>
          <icon-plus class="h-3.5 w-3.5 mr-1.5" />
          Generate Key
        </volt-button>
      </div>

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
            <volt-button variant="ghost" size="sm" disabled>Docs</volt-button>
          </div>
          <div class="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div>
              <p class="text-sm font-medium">REST API</p>
              <p class="text-xs text-muted-foreground font-mono">/api/v1/{{ '{' }}collection{{ '}' }}</p>
            </div>
            <volt-button variant="ghost" size="sm" disabled>Docs</volt-button>
          </div>
          <div class="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div>
              <p class="text-sm font-medium">Webhooks</p>
              <p class="text-xs text-muted-foreground">Trigger events on content changes</p>
            </div>
            <volt-button variant="ghost" size="sm" disabled>Configure</volt-button>
          </div>
        </div>
      </volt-card>

      <volt-card class="p-8">
        <div class="text-center space-y-3">
          <div class="h-12 w-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
            <icon-key class="h-6 w-6" />
          </div>
          <h3 class="text-sm font-medium">API key management not yet implemented</h3>
          <p class="text-xs text-muted-foreground max-w-sm mx-auto">
            This feature will allow you to generate and revoke API keys for external access to your CMS content.
          </p>
        </div>
      </volt-card>
    </div>
  `
})
export class ApiPage {}
