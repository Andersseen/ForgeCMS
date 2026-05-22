import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  VoltButton,
  VoltCard,
  VoltInput,
  VoltSeparator,
  VoltSwitch,
  VoltTabs,
  VoltTabsContent,
  VoltTabsList,
  VoltTabsTrigger
} from '@voltui/components';
import {
  IconCode,
  IconDatabase,
  IconGlobe,
  IconHardDrive,
  IconMail,
  IconShield,
  IconTerminal,
  IconZap
} from '../../../components/icons';

@Component({
  selector: 'forge-cms-settings',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    VoltInput,
    VoltSeparator,
    VoltSwitch,
    VoltTabs,
    VoltTabsList,
    VoltTabsTrigger,
    VoltTabsContent,
    IconGlobe,
    IconCode,
    IconZap,
    IconShield,
    IconMail,
    IconHardDrive,
    IconDatabase,
    IconTerminal
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Settings</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Configure your CMS instance and preferences.
        </p>
      </div>

      <volt-tabs [value]="activeTab()" (valueChange)="activeTab.set($event)">
        <volt-tabs-list
          class="w-full justify-start border-b border-border rounded-none bg-transparent p-0 h-auto"
        >
          <volt-tabs-trigger
            value="general"
            class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm"
            >General</volt-tabs-trigger
          >
          <volt-tabs-trigger
            value="api"
            class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm"
            >API</volt-tabs-trigger
          >
          <volt-tabs-trigger
            value="media"
            class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm"
            >Media</volt-tabs-trigger
          >
          <volt-tabs-trigger
            value="security"
            class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm"
            >Security</volt-tabs-trigger
          >
        </volt-tabs-list>

        <!-- General Tab -->
        <volt-tabs-content value="general" class="mt-6">
          <div class="max-w-2xl space-y-6">
            <volt-card class="p-6 space-y-4">
              <div class="flex items-center gap-3">
                <div
                  class="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
                >
                  <icon-globe class="h-5 w-5" />
                </div>
                <div>
                  <h2 class="font-semibold">Site Information</h2>
                  <p class="text-xs text-muted-foreground">Basic details about your project</p>
                </div>
              </div>
              <volt-separator />
              <div class="space-y-4">
                <div class="space-y-2">
                  <label class="text-sm font-medium">Site Name</label>
                  <volt-input value="ForgeCMS Demo" class="w-full" />
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium">Description</label>
                  <volt-input
                    value="An experimental CMS foundation for Angular and Analog.js"
                    class="w-full"
                  />
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Default Language</label>
                    <volt-input value="en-US" class="w-full" />
                  </div>
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Timezone</label>
                    <volt-input value="UTC" class="w-full" />
                  </div>
                </div>
              </div>
            </volt-card>

            <volt-card class="p-6 space-y-4">
              <div class="flex items-center gap-3">
                <div
                  class="h-9 w-9 rounded-lg bg-info/10 text-info flex items-center justify-center"
                >
                  <icon-mail class="h-5 w-5" />
                </div>
                <div>
                  <h2 class="font-semibold">Email Settings</h2>
                  <p class="text-xs text-muted-foreground">Configure email notifications</p>
                </div>
              </div>
              <volt-separator />
              <div class="space-y-4">
                <div class="space-y-2">
                  <label class="text-sm font-medium">From Address</label>
                  <volt-input value="noreply@forgecms.dev" class="w-full" />
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">New User Notifications</p>
                    <p class="text-xs text-muted-foreground">Send email when new users join</p>
                  </div>
                  <volt-switch [checked]="true" />
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">Content Alerts</p>
                    <p class="text-xs text-muted-foreground">Notify on publish and unpublish</p>
                  </div>
                  <volt-switch [checked]="true" />
                </div>
              </div>
            </volt-card>
          </div>
        </volt-tabs-content>

        <!-- API Tab -->
        <volt-tabs-content value="api" class="mt-6">
          <div class="max-w-2xl space-y-6">
            <volt-card class="p-6 space-y-4">
              <div class="flex items-center gap-3">
                <div
                  class="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
                >
                  <icon-code class="h-5 w-5" />
                </div>
                <div>
                  <h2 class="font-semibold">API Configuration</h2>
                  <p class="text-xs text-muted-foreground">REST and GraphQL settings</p>
                </div>
              </div>
              <volt-separator />
              <div class="space-y-4">
                <div class="space-y-2">
                  <label class="text-sm font-medium">GraphQL Endpoint</label>
                  <volt-input value="/api/graphql" class="w-full" readonly />
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium">REST API Base</label>
                  <volt-input value="/api/v1" class="w-full" readonly />
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">GraphQL Playground</p>
                    <p class="text-xs text-muted-foreground">Enable interactive API explorer</p>
                  </div>
                  <volt-switch [checked]="true" />
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">CORS</p>
                    <p class="text-xs text-muted-foreground">Allow cross-origin requests</p>
                  </div>
                  <volt-switch [checked]="true" />
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">Rate Limiting</p>
                    <p class="text-xs text-muted-foreground">Limit requests per minute</p>
                  </div>
                  <volt-switch [checked]="true" />
                </div>
              </div>
            </volt-card>

            <volt-card class="p-6 space-y-4">
              <div class="flex items-center gap-3">
                <div
                  class="h-9 w-9 rounded-lg bg-warning/10 text-warning flex items-center justify-center"
                >
                  <icon-zap class="h-5 w-5" />
                </div>
                <div>
                  <h2 class="font-semibold">Webhooks</h2>
                  <p class="text-xs text-muted-foreground">Send events to external services</p>
                </div>
              </div>
              <volt-separator />
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">Enable Webhooks</p>
                    <p class="text-xs text-muted-foreground">Trigger on content changes</p>
                  </div>
                  <volt-switch />
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">Retry on Failure</p>
                    <p class="text-xs text-muted-foreground">Auto-retry failed webhook calls</p>
                  </div>
                  <volt-switch [checked]="true" />
                </div>
              </div>
            </volt-card>
          </div>
        </volt-tabs-content>

        <!-- Media Tab -->
        <volt-tabs-content value="media" class="mt-6">
          <div class="max-w-2xl space-y-6">
            <volt-card class="p-6 space-y-4">
              <div class="flex items-center gap-3">
                <div
                  class="h-9 w-9 rounded-lg bg-info/10 text-info flex items-center justify-center"
                >
                  <icon-hard-drive class="h-5 w-5" />
                </div>
                <div>
                  <h2 class="font-semibold">Storage</h2>
                  <p class="text-xs text-muted-foreground">File upload and storage settings</p>
                </div>
              </div>
              <volt-separator />
              <div class="space-y-4">
                <div class="space-y-2">
                  <label class="text-sm font-medium">Max File Size</label>
                  <volt-input value="10 MB" class="w-full" />
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium">Allowed Types</label>
                  <volt-input value="jpg, png, gif, svg, mp4, pdf" class="w-full" />
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">Image Optimization</p>
                    <p class="text-xs text-muted-foreground">Auto-compress uploaded images</p>
                  </div>
                  <volt-switch [checked]="true" />
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">Generate Thumbnails</p>
                    <p class="text-xs text-muted-foreground">Create multiple sizes on upload</p>
                  </div>
                  <volt-switch [checked]="true" />
                </div>
              </div>
            </volt-card>
          </div>
        </volt-tabs-content>

        <!-- Security Tab -->
        <volt-tabs-content value="security" class="mt-6">
          <div class="max-w-2xl space-y-6">
            <volt-card class="p-6 space-y-4">
              <div class="flex items-center gap-3">
                <div
                  class="h-9 w-9 rounded-lg bg-success/10 text-success flex items-center justify-center"
                >
                  <icon-shield class="h-5 w-5" />
                </div>
                <div>
                  <h2 class="font-semibold">Authentication</h2>
                  <p class="text-xs text-muted-foreground">Login and session settings</p>
                </div>
              </div>
              <volt-separator />
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">Two-Factor Authentication</p>
                    <p class="text-xs text-muted-foreground">Require 2FA for admin users</p>
                  </div>
                  <volt-switch />
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">SSO / OAuth</p>
                    <p class="text-xs text-muted-foreground">Enable social login providers</p>
                  </div>
                  <volt-switch />
                </div>
              </div>
            </volt-card>

            <volt-card class="p-6 space-y-4">
              <div class="flex items-center gap-3">
                <div
                  class="h-9 w-9 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center"
                >
                  <icon-database class="h-5 w-5" />
                </div>
                <div>
                  <h2 class="font-semibold">Danger Zone</h2>
                  <p class="text-xs text-muted-foreground">Destructive actions</p>
                </div>
              </div>
              <volt-separator />
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium">Clear Cache</p>
                    <p class="text-xs text-muted-foreground">Invalidate all cached content</p>
                  </div>
                  <volt-button variant="outline" size="sm">Clear</volt-button>
                </div>
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-destructive">Reset CMS</p>
                    <p class="text-xs text-muted-foreground">Delete all content and settings</p>
                  </div>
                  <volt-button variant="destructive" size="sm">Reset</volt-button>
                </div>
              </div>
            </volt-card>
          </div>
        </volt-tabs-content>
      </volt-tabs>

      <!-- Save Button -->
      <div class="flex justify-end gap-2 max-w-2xl">
        <volt-button variant="outline">Cancel</volt-button>
        <volt-button>Save Changes</volt-button>
      </div>
    </div>
  `
})
export class SettingsPage {
  activeTab = signal('general');
}
