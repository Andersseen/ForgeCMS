import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { CanDeactivateFn } from '@angular/router';
import { map } from 'rxjs';
import { ApiValidationError, CmsApiService, documentResource } from '@forge-cms/angular';
import type { CollectionMeta } from '@forge-cms/angular';
import { ForgeCollectionFormComponent } from './collection-form.component.js';
import { LoadingStateComponent } from './loading-state.component.js';
import { ErrorStateComponent } from './error-state.component.js';
import { describeAdminError } from './admin-error.js';
import { ForgeContentRefresh } from './content-refresh.js';

/**
 * Orchestrates create-or-edit for one document: loads the schema (and, when editing, the document),
 * branches create vs. update on save, maps validation errors to the fields, and navigates back to
 * the parent workspace on success — everything `apps/www`'s `collection-detail.page.ts` used to
 * hand-roll around `ForgeCollectionFormComponent` (spec 052).
 *
 * Mounted by `forgeAdminContentRoutes()` as a child of `ForgeCollectionWorkspaceComponent`'s route,
 * on `new` (create) and `:id` (edit) — `documentId()` is `undefined` on the `new` route, which is
 * exactly the create/edit discriminator.
 */
@Component({
  selector: 'forge-document-editor',
  standalone: true,
  imports: [ForgeCollectionFormComponent, LoadingStateComponent, ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (metaLoading()) {
      <forge-loading-state variant="blocks" />
    } @else if (metaError(); as message) {
      <forge-error-state
        title="Couldn't load this collection"
        [message]="message"
        (retry)="loadMeta()"
      />
    } @else if (meta(); as collectionMeta) {
      @if (!isCreate() && documentRef.isLoading() && !documentRef.value()) {
        <forge-loading-state variant="blocks" />
      } @else if (documentRef.error(); as error) {
        <forge-error-state
          title="Couldn't load this document"
          [message]="describeAdminError(error)"
          (retry)="documentRef.reload()"
        />
      } @else {
        @if (saveError(); as message) {
          <p class="text-xs text-destructive mb-2">{{ message }}</p>
        }
        <forge-collection-form
          [fields]="collectionMeta.fieldDefinitions"
          [initialValue]="initialValue()"
          [fieldErrors]="fieldErrors()"
          [submitLabel]="isCreate() ? 'Create' : 'Save'"
          [locales]="collectionMeta.locales ?? []"
          (dirtyChange)="dirty.set($event)"
          (save)="onSave($event)"
          (cancel)="onCancel()"
        />
      }
    }
  `
})
export class ForgeDocumentEditorComponent {
  private readonly api = inject(CmsApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly refresh = inject(ForgeContentRefresh, { optional: true });

  /** Both fall back to route params, for standalone embedding outside the route helper. */
  collection = input<string | undefined>(undefined);
  /** `undefined` means create mode. */
  documentId = input<string | undefined>(undefined);

  // `collection` is matched by the parent route segment (`collections/:collection`), not this
  // component's own (`new` or `:id`) — Angular's default `paramsInheritanceStrategy` ('emptyOnly')
  // does not merge ancestor params into a routed component's own `paramMap`, so it has to be read
  // off the parent explicitly.
  private readonly routeCollection = toSignal(
    (this.route.parent?.paramMap ?? this.route.paramMap).pipe(
      map((params) => params.get('collection') ?? undefined)
    ),
    { initialValue: undefined }
  );
  private readonly routeId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? undefined)),
    { initialValue: undefined }
  );

  protected readonly collectionSlug = computed(() => this.collection() ?? this.routeCollection());
  protected readonly effectiveId = computed(() => this.documentId() ?? this.routeId());
  protected readonly isCreate = computed(() => this.effectiveId() === undefined);

  protected readonly meta = signal<CollectionMeta | null>(null);
  protected readonly metaLoading = signal(true);
  protected readonly metaError = signal<string | null>(null);
  private metaToken = 0;

  protected readonly documentRef = documentResource<Record<string, unknown>>(() => {
    const collection = this.collectionSlug();
    const id = this.effectiveId();
    if (collection === undefined || id === undefined) return undefined;
    return { collection, id };
  });

  protected readonly initialValue = computed<Record<string, unknown>>(
    () => this.documentRef.value() ?? {}
  );

  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly saveError = signal<string | null>(null);
  protected readonly dirty = signal(false);
  protected readonly describeAdminError = describeAdminError;

  constructor() {
    effect(() => {
      const slug = this.collectionSlug();
      if (slug === undefined) return;
      void this.loadMeta();
    });
  }

  protected async loadMeta(): Promise<void> {
    const slug = this.collectionSlug();
    if (slug === undefined) return;

    const token = ++this.metaToken;
    this.metaLoading.set(true);
    this.metaError.set(null);

    try {
      const all = await this.api.getCollections();
      if (token !== this.metaToken) return;
      const found = all.find((entry) => entry.slug === slug) ?? null;
      this.meta.set(found);
      if (found === null) this.metaError.set(`Collection "${slug}" was not found.`);
    } catch (err) {
      if (token !== this.metaToken) return;
      this.metaError.set(describeAdminError(err));
    } finally {
      if (token === this.metaToken) this.metaLoading.set(false);
    }
  }

  protected async onSave(data: Record<string, unknown>): Promise<void> {
    const slug = this.collectionSlug();
    if (slug === undefined) return;

    this.saveError.set(null);
    this.fieldErrors.set({});

    try {
      const id = this.effectiveId();
      if (id === undefined) {
        await this.api.createDocument(slug, data);
      } else {
        await this.api.updateDocument(slug, id, data);
      }
      this.dirty.set(false);
      this.refresh?.bump();
      void this.router.navigate(['..'], { relativeTo: this.route });
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const fieldErrors: Record<string, string> = {};
        for (const detail of err.details) fieldErrors[detail.field] = detail.message;
        this.fieldErrors.set(fieldErrors);
      }
      this.saveError.set(describeAdminError(err));
    }
  }

  protected onCancel(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  /** Called by {@link canDeactivateForgeDocumentEditor}. */
  canDeactivate(): boolean {
    if (!this.dirty()) return true;
    return window.confirm('You have unsaved changes. Leave without saving?');
  }
}

/**
 * Wires {@link ForgeDocumentEditorComponent.canDeactivate} into Angular's route guard system.
 * `forgeAdminContentRoutes()` attaches this to the `new`/`:id` routes automatically — a host gets
 * the unsaved-changes prompt for free.
 */
export const canDeactivateForgeDocumentEditor: CanDeactivateFn<ForgeDocumentEditorComponent> = (
  component
) => component.canDeactivate();
