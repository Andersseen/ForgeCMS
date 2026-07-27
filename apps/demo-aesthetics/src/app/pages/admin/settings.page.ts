import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { CmsApiService, type CollectionMeta } from '@forge-cms/angular';
import {
  ErrorStateComponent,
  ForgeCollectionFormComponent,
  PageHeaderComponent
} from '@forge-cms/admin';

/**
 * Site settings, edited as a single document.
 *
 * FINDING 4 in practice: because ForgeCMS has no globals, this page has to find the one
 * `site_settings` row, remember its id, and decide between create and update itself. A `global`
 * would make this `runtime.updateGlobal('site_settings', value)` with no id and no ambiguity.
 */
@Component({
  selector: 'lumea-admin-settings',
  standalone: true,
  imports: [PageHeaderComponent, ErrorStateComponent, ForgeCollectionFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header
        title="Clinic settings"
        subtitle="Name, contact details and opening hours — used by the site header and footer."
      />

      @if (saved()) {
        <p class="rounded-lg border border-border bg-muted px-4 py-3 text-sm">Settings saved.</p>
      }

      @if (error(); as message) {
        <forge-error-state title="Unable to load settings" [message]="message" (retry)="load()" />
      } @else if (collection(); as meta) {
        <forge-collection-form
          [fields]="meta.fieldDefinitions"
          [initialValue]="document() ?? {}"
          [fieldErrors]="fieldErrors()"
          submitLabel="Save settings"
          (save)="save($event)"
          (cancel)="load()"
        />
      } @else {
        <p class="text-sm text-muted-foreground">Loading…</p>
      }
    </div>
  `
})
export class AdminSettingsPage implements OnInit {
  private readonly cms = inject(CmsApiService);

  protected readonly collection = signal<CollectionMeta | null>(null);
  protected readonly document = signal<Record<string, unknown> | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    this.saved.set(false);
    try {
      const collections = await this.cms.getCollections();
      this.collection.set(collections.find((entry) => entry.slug === 'site_settings') ?? null);

      const [settings] = await this.cms.getDocuments('site_settings', { limit: 1 });
      this.document.set(settings ?? null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load settings');
    }
  }

  protected async save(value: Record<string, unknown>): Promise<void> {
    this.fieldErrors.set({});
    this.saved.set(false);

    try {
      const existing = this.document();
      if (existing?.['id']) {
        await this.cms.updateDocument('site_settings', String(existing['id']), value);
      } else {
        await this.cms.createDocument('site_settings', value);
      }
      this.saved.set(true);
      await this.load();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save settings');
    }
  }
}
