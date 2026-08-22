import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { CmsApiService, canWriteContent, type AuthUser } from '@forge-cms/angular';
import {
  ErrorStateComponent,
  LoadingStateComponent,
  PageHeaderComponent
} from '@forge-cms/admin';
import { VoltButton, VoltCard, VoltInput, VoltLabel, VoltTextarea } from '@voltui/components';

interface TranslationProject {
  id: string;
  name: string;
  slug: string;
  sourceLocale: string;
  locales: string[];
  description?: string;
}

interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  total: number;
  errors: { key: string; reason: string }[];
}

@Component({
  selector: 'forge-cms-translations-page',
  standalone: true,
  imports: [
    VoltButton,
    VoltCard,
    VoltInput,
    VoltLabel,
    VoltTextarea,
    PageHeaderComponent,
    LoadingStateComponent,
    ErrorStateComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <forge-page-header title="Translations" subtitle="Manage translation catalogs" />

    @if (loading()) {
      <forge-loading-state variant="table" />
    } @else if (error()) {
      <forge-error-state title="Unable to load projects" [message]="error()" (retry)="load()" />
    } @else {
      <div class="space-y-6">
        @if (canWrite()) {
          <volt-card class="p-4">
            <h3 class="text-sm font-medium mb-3">
              {{ editingProject() ? 'Edit project' : 'New project' }}
            </h3>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <volt-label htmlFor="proj-name">Name</volt-label>
                <volt-input id="proj-name" [value]="formName()" (valueChange)="formName.set($event)" />
              </div>
              <div>
                <volt-label htmlFor="proj-source">Source locale</volt-label>
                <volt-input id="proj-source" [value]="formSourceLocale()" (valueChange)="formSourceLocale.set($event)" />
              </div>
              <div class="col-span-2">
                <volt-label htmlFor="proj-locales">Locales (comma-separated)</volt-label>
                <volt-input id="proj-locales" [value]="formLocales()" (valueChange)="formLocales.set($event)" />
              </div>
              <div class="col-span-2">
                <volt-label htmlFor="proj-desc">Description</volt-label>
                <volt-textarea id="proj-desc" [value]="formDescription()" (valueChange)="formDescription.set($event)" />
              </div>
            </div>
            <div class="flex gap-2 mt-3">
              <volt-button size="sm" (click)="saveProject()">
                {{ editingProject() ? 'Update' : 'Create' }}
              </volt-button>
              @if (editingProject()) {
                <volt-button size="sm" variant="outline" (click)="cancelEdit()">Cancel</volt-button>
              }
            </div>
          </volt-card>
        }

        @for (project of projects(); track project.id) {
          <volt-card class="p-4">
            <div class="flex items-start justify-between mb-2">
              <div>
                <h3 class="font-medium">{{ project.name }}</h3>
                <p class="text-xs text-muted-foreground">
                  {{ project.slug }} &middot; source: {{ project.sourceLocale }} &middot;
                  locales: {{ project.locales.join(', ') }}
                </p>
                @if (project.description) {
                  <p class="text-sm text-muted-foreground mt-1">{{ project.description }}</p>
                }
              </div>
              <div class="flex gap-1">
                @if (canWrite()) {
                  <volt-button size="sm" variant="outline" (click)="editProject(project)">Edit</volt-button>
                }
              </div>
            </div>

            <div class="border-t border-border pt-3 mt-2 space-y-3">
              @for (locale of project.locales; track locale) {
                <div class="flex items-center gap-3">
                  <span class="text-sm font-mono w-16">{{ locale }}</span>
                  @if (locale === project.sourceLocale) {
                    <span class="text-xs text-muted-foreground">(source)</span>
                  }
                  <div class="flex gap-1 ml-auto">
                    @if (canWrite()) {
                      <volt-button size="sm" variant="outline" (click)="triggerImport(project.slug, locale, fileInput)">Import</volt-button>
                    }
                    <volt-button size="sm" variant="outline" (click)="exportCatalog(project.slug, locale)">Export</volt-button>
                  </div>
                </div>
              }
            </div>

            @if (importResult()) {
              <div class="border-t border-border pt-3 mt-3 text-sm">
                <p class="font-medium">Import result:</p>
                <p>Created: {{ importResult()!.created }}, Updated: {{ importResult()!.updated }}, Unchanged: {{ importResult()!.unchanged }}, Total: {{ importResult()!.total }}</p>
                @if (importResult()!.errors.length > 0) {
                  <p class="text-destructive mt-1">{{ importResult()!.errors.length }} error(s):</p>
                  <ul class="list-disc list-inside text-xs text-destructive">
                    @for (err of importResult()!.errors; track err.key) {
                      <li>{{ err.key }}: {{ err.reason }}</li>
                    }
                  </ul>
                }
              </div>
            }
          </volt-card>
        } @empty {
          <p class="text-sm text-muted-foreground">No translation projects yet.</p>
        }

        <input #fileInput type="file" accept=".json" class="hidden" (change)="onFileSelected($event)" />
      </div>
    }
  `
})
export class TranslationsPage implements OnInit {
  private readonly api = inject(CmsApiService);

  readonly projects = signal<TranslationProject[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly currentUser = signal<AuthUser | null>(null);
  readonly importResult = signal<ImportResult | null>(null);

  readonly editingProject = signal<TranslationProject | null>(null);
  readonly formName = signal('');
  readonly formSourceLocale = signal('en');
  readonly formLocales = signal('en');
  readonly formDescription = signal('');

  private pendingImport: { projectSlug: string; locale: string } | null = null;

  readonly canWrite = canWriteContent;

  async ngOnInit(): Promise<void> {
    const user = await this.api.getCurrentUser();
    this.currentUser.set(user);
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const docs = await this.api.getDocuments<TranslationProject>('translation_projects');
      this.projects.set(
        docs.map((d) => ({
          ...d,
          locales: Array.isArray(d.locales) ? d.locales : []
        }))
      );
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      this.loading.set(false);
    }
  }

  editProject(project: TranslationProject): void {
    this.editingProject.set(project);
    this.formName.set(project.name);
    this.formSourceLocale.set(project.sourceLocale);
    this.formLocales.set(project.locales.join(', '));
    this.formDescription.set(project.description ?? '');
  }

  cancelEdit(): void {
    this.editingProject.set(null);
    this.formName.set('');
    this.formSourceLocale.set('en');
    this.formLocales.set('en');
    this.formDescription.set('');
  }

  async saveProject(): Promise<void> {
    const locales = this.formLocales()
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const data: Record<string, unknown> = {
      name: this.formName(),
      sourceLocale: this.formSourceLocale(),
      locales,
      description: this.formDescription() || undefined
    };

    try {
      const editing = this.editingProject();
      if (editing) {
        await this.api.updateDocument('translation_projects', editing.id, data);
      } else {
        await this.api.createDocument('translation_projects', data);
      }
      this.cancelEdit();
      await this.load();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save project');
    }
  }

  triggerImport(projectSlug: string, locale: string, fileInput: HTMLInputElement): void {
    this.pendingImport = { projectSlug, locale };
    this.importResult.set(null);
    fileInput.value = '';
    fileInput.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.pendingImport) return;

    try {
      const text = await file.text();
      const catalog = JSON.parse(text) as Record<string, unknown>;
      const authToken = localStorage.getItem('forge-auth-token');

      const response = await fetch(
        `/api/v1/translations/${this.pendingImport.projectSlug}/import/${this.pendingImport.locale}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(authToken ? { authorization: `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify(catalog)
        }
      );

      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `Import failed: ${response.status}`);
      }

      const body = (await response.json()) as { data: ImportResult };
      this.importResult.set(body.data);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Import failed');
    } finally {
      this.pendingImport = null;
    }
  }

  async exportCatalog(projectSlug: string, locale: string): Promise<void> {
    try {
      const authToken = localStorage.getItem('forge-auth-token');
      const response = await fetch(
        `/api/v1/translations/${projectSlug}/catalog/${locale}`,
        {
          headers: {
            ...(authToken ? { authorization: `Bearer ${authToken}` } : {})
          }
        }
      );

      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `Export failed: ${response.status}`);
      }

      const catalog = await response.json();
      const jsonStr = JSON.stringify(catalog, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectSlug}.${locale}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Export failed');
    }
  }
}
