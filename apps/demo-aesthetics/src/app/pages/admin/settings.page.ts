import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { ApiValidationError, CmsApiService, type CollectionMeta } from '@forge-cms/angular';
import {
  ErrorStateComponent,
  ForgeFieldControlComponent,
  PageHeaderComponent,
  normaliseReferences
} from '@forge-cms/admin';
import { VoltButton } from '@voltui/components';

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
  imports: [PageHeaderComponent, ErrorStateComponent, ForgeFieldControlComponent, VoltButton],
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
        <form
          class="max-w-3xl space-y-5 rounded-lg border border-border bg-card p-5 shadow-sm"
          (submit)="save($event)"
        >
          @for (field of meta.fieldDefinitions; track field.name) {
            <forge-field-control
              [field]="field"
              [value]="formValue()[field.name]"
              [errors]="fieldErrors()"
              [path]="field.name"
              [locales]="meta.locales ?? []"
              (valueChange)="setValue(field.name, $event)"
            />
          }

          <div class="flex items-center justify-end gap-2 border-t border-border pt-4">
            <volt-button type="button" variant="outline" size="sm" (click)="resetForm()">
              Reset
            </volt-button>
            <volt-button type="submit" size="sm">Save settings</volt-button>
          </div>
        </form>
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
  private readonly edits = signal<Record<string, unknown>>({});

  protected readonly formValue = computed<Record<string, unknown>>(() => ({
    ...normaliseReferences(this.collection()?.fieldDefinitions ?? [], this.document() ?? {}),
    ...this.edits()
  }));

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
      this.edits.set({});
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load settings');
    }
  }

  protected setValue(name: string, value: unknown): void {
    this.edits.update((current) => ({ ...current, [name]: value }));
    this.saved.set(false);
  }

  protected resetForm(): void {
    this.edits.set({});
    this.fieldErrors.set({});
    this.saved.set(false);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    this.fieldErrors.set({});
    this.saved.set(false);

    try {
      const existing = this.document();
      if (existing?.['id']) {
        await this.cms.updateDocument('site_settings', String(existing['id']), this.formValue());
      } else {
        await this.cms.createDocument('site_settings', this.formValue());
      }
      await this.load();
      this.saved.set(true);
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const errors: Record<string, string> = {};
        for (const detail of err.details) errors[detail.field] = detail.message;
        this.fieldErrors.set(errors);
        return;
      }
      this.error.set(err instanceof Error ? err.message : 'Failed to save settings');
    }
  }
}
