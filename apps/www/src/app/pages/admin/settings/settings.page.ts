import { ChangeDetectionStrategy, Component, signal, inject, type WritableSignal } from '@angular/core';
import type { OnInit } from '@angular/core';
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
  IconAlertCircle,
  IconCheckCircle,
  IconCode,
  IconDatabase,
  IconGlobe,
  IconHardDrive,
  IconMail,
  IconShield,
  IconZap
} from '../../../components/icons';
import { CmsApiService } from '@forge-cms/angular';
import {
  PageHeaderComponent,
  LoadingStateComponent,
  ErrorStateComponent,
  SettingsCardComponent
} from '../components';

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

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
    IconAlertCircle,
    IconCheckCircle,
    PageHeaderComponent,
    LoadingStateComponent,
    ErrorStateComponent,
    SettingsCardComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header title="Settings" subtitle="Configure your CMS instance and preferences." />

      @if (loading()) {
        <forge-loading-state variant="blocks" />
      } @else if (error()) {
        <forge-error-state
          title="Unable to load settings"
          [message]="error()"
          (retry)="loadSettings()"
        />
      } @else {
        <volt-tabs [value]="activeTab()" (valueChange)="setTab($event)">
          <volt-tabs-list class="w-full justify-start border-b border-border rounded-none bg-transparent p-0 h-auto">
            <volt-tabs-trigger value="general" class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">General</volt-tabs-trigger>
            <volt-tabs-trigger value="api" class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">API</volt-tabs-trigger>
            <volt-tabs-trigger value="media" class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">Media</volt-tabs-trigger>
            <volt-tabs-trigger value="security" class="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm">Security</volt-tabs-trigger>
          </volt-tabs-list>

          <volt-tabs-content value="general" class="mt-6">
            <div class="max-w-2xl space-y-6">
              <forge-settings-card title="Site Information" subtitle="Basic details about your project" iconColor="primary">
                <icon-globe icon class="h-5 w-5" />
                <div class="space-y-4">
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Site Name</label>
                    <volt-input [value]="siteName()" (input)="onInput(siteName, $event)" class="w-full" />
                  </div>
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Description</label>
                    <volt-input [value]="description()" (input)="onInput(description, $event)" class="w-full" />
                  </div>
                  <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                      <label class="text-sm font-medium">Default Language</label>
                      <volt-input [value]="defaultLanguage()" (input)="onInput(defaultLanguage, $event)" class="w-full" />
                    </div>
                    <div class="space-y-2">
                      <label class="text-sm font-medium">Timezone</label>
                      <volt-input [value]="timezone()" (input)="onInput(timezone, $event)" class="w-full" />
                    </div>
                  </div>
                </div>
              </forge-settings-card>

              <forge-settings-card title="Email Settings" subtitle="Configure email notifications" iconColor="info">
                <icon-mail icon class="h-5 w-5" />
                <div class="space-y-4">
                  <div class="space-y-2">
                    <label class="text-sm font-medium">From Address</label>
                    <volt-input [value]="fromAddress()" (input)="onInput(fromAddress, $event)" class="w-full" />
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">New User Notifications</p>
                      <p class="text-xs text-muted-foreground">Send email when new users join</p>
                    </div>
                    <volt-switch [checked]="newUserNotifications()" (change)="toggle(newUserNotifications, $event)" />
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">Content Alerts</p>
                      <p class="text-xs text-muted-foreground">Notify on publish and unpublish</p>
                    </div>
                    <volt-switch [checked]="contentAlerts()" (change)="toggle(contentAlerts, $event)" />
                  </div>
                </div>
              </forge-settings-card>
            </div>
          </volt-tabs-content>

          <volt-tabs-content value="api" class="mt-6">
            <div class="max-w-2xl space-y-6">
              <forge-settings-card title="API Configuration" subtitle="REST and GraphQL settings" iconColor="primary">
                <icon-code icon class="h-5 w-5" />
                <div class="space-y-4">
                  <div class="space-y-2">
                    <label class="text-sm font-medium">GraphQL Endpoint</label>
                    <volt-input [value]="graphqlEndpoint()" class="w-full" readonly />
                  </div>
                  <div class="space-y-2">
                    <label class="text-sm font-medium">REST API Base</label>
                    <volt-input [value]="restApiBase()" class="w-full" readonly />
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">GraphQL Playground</p>
                      <p class="text-xs text-muted-foreground">Enable interactive API explorer</p>
                    </div>
                    <volt-switch [checked]="graphqlPlayground()" (change)="toggle(graphqlPlayground, $event)" />
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">CORS</p>
                      <p class="text-xs text-muted-foreground">Allow cross-origin requests</p>
                    </div>
                    <volt-switch [checked]="cors()" (change)="toggle(cors, $event)" />
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">Rate Limiting</p>
                      <p class="text-xs text-muted-foreground">Limit requests per minute</p>
                    </div>
                    <volt-switch [checked]="rateLimiting()" (change)="toggle(rateLimiting, $event)" />
                  </div>
                </div>
              </forge-settings-card>

              <forge-settings-card title="Webhooks" subtitle="Send events to external services" iconColor="warning">
                <icon-zap icon class="h-5 w-5" />
                <div class="space-y-4">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">Enable Webhooks</p>
                      <p class="text-xs text-muted-foreground">Trigger on content changes</p>
                    </div>
                    <volt-switch [checked]="webhooksEnabled()" (change)="toggle(webhooksEnabled, $event)" />
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">Retry on Failure</p>
                      <p class="text-xs text-muted-foreground">Auto-retry failed webhook calls</p>
                    </div>
                    <volt-switch [checked]="webhooksRetry()" (change)="toggle(webhooksRetry, $event)" />
                  </div>
                </div>
              </forge-settings-card>
            </div>
          </volt-tabs-content>

          <volt-tabs-content value="media" class="mt-6">
            <div class="max-w-2xl space-y-6">
              <forge-settings-card title="Storage" subtitle="File upload and storage settings" iconColor="info">
                <icon-hard-drive icon class="h-5 w-5" />
                <div class="space-y-4">
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Max File Size</label>
                    <volt-input [value]="maxFileSize()" (input)="onInput(maxFileSize, $event)" class="w-full" />
                  </div>
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Allowed Types</label>
                    <volt-input [value]="allowedTypes()" (input)="onInput(allowedTypes, $event)" class="w-full" />
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">Image Optimization</p>
                      <p class="text-xs text-muted-foreground">Auto-compress uploaded images</p>
                    </div>
                    <volt-switch [checked]="imageOptimization()" (change)="toggle(imageOptimization, $event)" />
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">Generate Thumbnails</p>
                      <p class="text-xs text-muted-foreground">Create multiple sizes on upload</p>
                    </div>
                    <volt-switch [checked]="generateThumbnails()" (change)="toggle(generateThumbnails, $event)" />
                  </div>
                </div>
              </forge-settings-card>
            </div>
          </volt-tabs-content>

          <volt-tabs-content value="security" class="mt-6">
            <div class="max-w-2xl space-y-6">
              <forge-settings-card title="Authentication" subtitle="Login and session settings" iconColor="success">
                <icon-shield icon class="h-5 w-5" />
                <div class="space-y-4">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">Two-Factor Authentication</p>
                      <p class="text-xs text-muted-foreground">Require 2FA for admin users</p>
                    </div>
                    <volt-switch [checked]="twoFactorAuth()" (change)="toggle(twoFactorAuth, $event)" />
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">SSO / OAuth</p>
                      <p class="text-xs text-muted-foreground">Enable social login providers</p>
                    </div>
                    <volt-switch [checked]="ssoOAuth()" (change)="toggle(ssoOAuth, $event)" />
                  </div>
                </div>
              </forge-settings-card>

              <forge-settings-card title="Danger Zone" subtitle="Destructive actions" iconColor="destructive">
                <icon-database icon class="h-5 w-5" />
                <div class="space-y-4">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">Clear Cache</p>
                      <p class="text-xs text-muted-foreground">Invalidate all cached content</p>
                    </div>
                    <volt-button variant="outline" size="sm" disabled>Clear</volt-button>
                  </div>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium text-destructive">Reset CMS</p>
                      <p class="text-xs text-muted-foreground">Delete all content and settings</p>
                    </div>
                    <volt-button variant="destructive" size="sm" disabled>Reset</volt-button>
                  </div>
                </div>
              </forge-settings-card>
            </div>
          </volt-tabs-content>
        </volt-tabs>

        <div class="flex justify-end gap-2 max-w-2xl">
          @if (saved()) {
            <span class="inline-flex items-center gap-1 text-xs text-success mr-auto self-center">
              <icon-check-circle class="h-3.5 w-3.5" />
              Saved
            </span>
          }
          @if (saveError()) {
            <span class="inline-flex items-center gap-1 text-xs text-destructive mr-auto self-center">
              <icon-alert-circle class="h-3.5 w-3.5" />
              {{ saveError() }}
            </span>
          }
          <volt-button variant="outline" [disabled]="saving()" (click)="reset()">Cancel</volt-button>
          <volt-button [disabled]="saving()" (click)="save()">
            @if (saving()) { Saving... } @else { Save Changes }
          </volt-button>
        </div>
      }
    </div>
  `
})
export class SettingsPage implements OnInit {
  private api = inject(CmsApiService);

  activeTab = signal('general');
  loading = signal(true);
  error = signal<string | null>(null);
  saving = signal(false);
  saved = signal(false);
  saveError = signal<string | null>(null);
  configId = signal<string | null>(null);

  siteName = signal('');
  description = signal('');
  defaultLanguage = signal('');
  timezone = signal('');
  fromAddress = signal('');
  newUserNotifications = signal(false);
  contentAlerts = signal(false);

  graphqlEndpoint = signal('/api/graphql');
  restApiBase = signal('/api/v1');
  graphqlPlayground = signal(true);
  cors = signal(true);
  rateLimiting = signal(true);
  webhooksEnabled = signal(false);
  webhooksRetry = signal(true);

  maxFileSize = signal('10 MB');
  allowedTypes = signal('jpg, png, gif, svg, mp4, pdf');
  imageOptimization = signal(true);
  generateThumbnails = signal(true);

  twoFactorAuth = signal(false);
  ssoOAuth = signal(false);

  ngOnInit() {
    void this.loadSettings();
  }

  async loadSettings() {
    this.loading.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      const docs = await this.api.getDocuments('site_config');
      if (docs.length > 0) {
        const d = docs[0]!;
        this.configId.set(d.id as string);
        this.siteName.set((d.siteName as string) ?? '');
        this.description.set((d.description as string) ?? '');
        this.defaultLanguage.set((d.defaultLanguage as string) ?? '');
        this.timezone.set((d.timezone as string) ?? '');
        this.fromAddress.set((d.fromAddress as string) ?? '');
        this.newUserNotifications.set(bool(d.newUserNotifications));
        this.contentAlerts.set(bool(d.contentAlerts));

        this.graphqlPlayground.set(bool(d.graphqlPlayground));
        this.cors.set(bool(d.cors));
        this.rateLimiting.set(bool(d.rateLimiting));
        this.webhooksEnabled.set(bool(d.webhooksEnabled));
        this.webhooksRetry.set(bool(d.webhooksRetry));

        this.maxFileSize.set((d.maxFileSize as string) ?? '10 MB');
        this.allowedTypes.set((d.allowedTypes as string) ?? 'jpg, png, gif, svg, mp4, pdf');
        this.imageOptimization.set(bool(d.imageOptimization));
        this.generateThumbnails.set(bool(d.generateThumbnails));

        this.twoFactorAuth.set(bool(d.twoFactorAuth));
        this.ssoOAuth.set(bool(d.ssoOAuth));
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      this.loading.set(false);
    }
  }

  onInput(field: WritableSignal<string>, event: Event) {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    field.set(value);
  }

  setTab(value: string | undefined) {
    this.activeTab.set(value ?? 'general');
  }

  toggle(field: WritableSignal<boolean>, event: Event) {
    const target = event.target as HTMLInputElement | null;
    const val = target?.checked ?? !field();
    field.set(val);
  }

  reset() {
    void this.loadSettings();
    this.saved.set(false);
    this.saveError.set(null);
  }

  async save() {
    const id = this.configId();
    if (!id) {
      this.saveError.set('No configuration found to update');
      return;
    }
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(null);
    try {
      await this.api.updateDocument('site_config', id, {
        siteName: this.siteName(),
        description: this.description(),
        defaultLanguage: this.defaultLanguage(),
        timezone: this.timezone(),
        fromAddress: this.fromAddress(),
        newUserNotifications: this.newUserNotifications(),
        contentAlerts: this.contentAlerts(),
        graphqlPlayground: this.graphqlPlayground(),
        cors: this.cors(),
        rateLimiting: this.rateLimiting(),
        webhooksEnabled: this.webhooksEnabled(),
        webhooksRetry: this.webhooksRetry(),
        maxFileSize: this.maxFileSize(),
        allowedTypes: this.allowedTypes(),
        imageOptimization: this.imageOptimization(),
        generateThumbnails: this.generateThumbnails(),
        twoFactorAuth: this.twoFactorAuth(),
        ssoOAuth: this.ssoOAuth()
      });
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 3000);
    } catch (e) {
      this.saveError.set(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      this.saving.set(false);
    }
  }
}
