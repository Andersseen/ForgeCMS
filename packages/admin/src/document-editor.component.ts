import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { CanDeactivateFn } from '@angular/router';
import { map } from 'rxjs';
import {
  ApiValidationError,
  CmsApiService,
  ForgeAuthSession,
  canWriteContent,
  documentResource
} from '@forge-cms/angular';
import type { CollectionMeta } from '@forge-cms/angular';
import { ForgeCollectionFormComponent } from './collection-form.component.js';
import { ForgeConfirmDialogComponent } from './confirm-dialog.component.js';
import { LoadingStateComponent } from './loading-state.component.js';
import { ErrorStateComponent } from './error-state.component.js';
import { describeAdminError, isForbiddenError } from './admin-error.js';
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
  imports: [
    ForgeCollectionFormComponent,
    ForgeConfirmDialogComponent,
    LoadingStateComponent,
    ErrorStateComponent
  ],
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
      @if (!isCreate() && loadedDocument() === undefined && documentRef.isLoading()) {
        <forge-loading-state variant="blocks" />
      } @else if (loadedDocument() === undefined && !isCreate() && documentRef.error(); as error) {
        <forge-error-state
          title="Couldn't load this document"
          [message]="describeAdminError(error)"
          (retry)="documentRef.reload()"
        />
      } @else {
        <!-- One form per collection + document identity (create mode is its own identity): local
             edits belong to exactly that identity and never leak into another, while a failed save
             or a remote refresh of the *same* document keeps them. -->
        @for (identity of identities(); track identity) {
          <forge-collection-form
            [fields]="collectionMeta.fieldDefinitions"
            [initialValue]="initialValue()"
            [fieldErrors]="fieldErrors()"
            [submitLabel]="isCreate() ? 'Create' : 'Save'"
            [locales]="collectionMeta.locales ?? []"
            [submitting]="saving()"
            [submitDisabled]="blockedMessage() !== null"
            [error]="blockedMessage() ?? saveError()"
            (dirtyChange)="dirty.set($event)"
            (save)="onSave($event)"
            (cancel)="onCancel()"
          />
        }
      }
    }

    <!-- The unsaved-changes prompt (spec 086): the same accessible dialog as delete, not window.confirm. -->
    <forge-confirm-dialog
      [open]="leavePrompt()"
      title="Leave without saving?"
      message="You have unsaved changes. If you leave now, they will be lost."
      confirmLabel="Leave without saving"
      cancelLabel="Stay"
      (confirm)="answerLeave(true)"
      (cancel)="answerLeave(false)"
    />
  `
})
export class ForgeDocumentEditorComponent {
  private readonly api = inject(CmsApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly refresh = inject(ForgeContentRefresh, { optional: true });
  private readonly session = inject(ForgeAuthSession);

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
  /** The collection + document the local draft belongs to; create mode is `#new`. */
  private readonly identityKey = computed(
    () => `${this.collectionSlug() ?? ''}/${this.effectiveId() ?? '#new'}`
  );
  protected readonly identities = computed(() => [this.identityKey()]);
  /** Advances on every identity change (A → B → A included), so a write can tell "still this visit". */
  private readonly visit = linkedSignal<string, number>({
    source: this.identityKey,
    computation: (_key, previous) => (previous?.value ?? 0) + 1
  });

  protected readonly meta = signal<CollectionMeta | null>(null);
  protected readonly metaLoading = signal(true);
  protected readonly metaError = signal<string | null>(null);
  private metaToken = 0;

  protected readonly documentRef = documentResource(() => {
    const collection = this.collectionSlug();
    const id = this.effectiveId();
    if (collection === undefined || id === undefined) return undefined;
    return { collection, id };
  });

  /**
   * The server document for the identity on screen. Unlike `documentRef.value()` it survives the
   * resource resetting for the *same* document — a session expiring (credential revision) or a
   * remote refresh reloads the resource, and that must not unmount the form and its unsaved edits.
   * A different identity starts from nothing.
   */
  protected readonly loadedDocument = linkedSignal<
    { key: string; user: string | null; value: Record<string, unknown> | undefined },
    Record<string, unknown> | undefined
  >({
    source: () => ({
      key: this.identityKey(),
      user: this.session.user()?.id ?? null,
      value: this.documentRef.value()
    }),
    // Carried over only for the same document and either the same user or a session that *expired*
    // (the form must survive that). Another user signing in, or a plain logout, never inherits it.
    computation: (source, previous) =>
      source.value ??
      (previous?.source.key === source.key &&
      (previous.source.user === source.user || this.session.expired())
        ? previous.value
        : undefined)
  });

  protected readonly initialValue = computed<Record<string, unknown>>(
    () => this.loadedDocument() ?? {}
  );

  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly saveError = signal<string | null>(null);
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);

  /** Saving is pointless while the server has said the session ended or the role cannot write. The
   *  entered values stay on screen; only a signed-in role known to be read-only blocks (anonymous
   *  writes are the server's call). */
  protected readonly blockedMessage = computed<string | null>(() => {
    if (this.session.expired()) {
      return "Your session expired. Your changes are still here, but they can't be saved until you sign in again.";
    }
    const user = this.session.user();
    if (user !== null && !canWriteContent(user)) {
      return "Your account can't edit content. Your changes are still here but can't be saved.";
    }
    return null;
  });
  protected readonly describeAdminError = describeAdminError;

  constructor() {
    // A navigation that outlives the editor must not hang on an unanswered prompt.
    inject(DestroyRef).onDestroy(() => this.pendingLeave?.resolve(false));

    effect(() => {
      const slug = this.collectionSlug();
      if (slug === undefined) return;
      void this.loadMeta();
    });

    // A different document (A → B, or edit → `new`) starts clean: A's unsaved-changes flag and save
    // errors must not carry over. Its loaded value cannot either — `documentResource` resets on a new
    // request (spec 077).
    effect(() => {
      this.collectionSlug();
      this.effectiveId();
      untracked(() => {
        this.dirty.set(false);
        this.saving.set(false);
        this.saveError.set(null);
        this.fieldErrors.set({});
      });
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
    if (slug === undefined || this.saving() || this.blockedMessage() !== null) return;

    const visit = this.visit();
    this.saving.set(true);
    this.saveError.set(null);
    this.fieldErrors.set({});

    try {
      const id = this.effectiveId();
      if (id === undefined) {
        await this.api.createDocument(slug, data);
      } else {
        await this.api.updateDocument(slug, id, data);
      }
      // The write happened whichever document is on screen now; only the one that was saved is done.
      this.refresh?.bump();
      if (visit !== this.visit()) return;
      this.dirty.set(false);
      void this.router.navigate(['..'], { relativeTo: this.route });
    } catch (err) {
      if (visit !== this.visit()) return;
      if (isForbiddenError(err)) void this.session.refresh();
      if (err instanceof ApiValidationError) {
        const fieldErrors: Record<string, string> = {};
        for (const detail of err.details) fieldErrors[detail.field] = detail.message;
        this.fieldErrors.set(fieldErrors);
      }
      this.saveError.set(describeAdminError(err));
    } finally {
      if (visit === this.visit()) this.saving.set(false);
    }
  }

  protected onCancel(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  /** The unsaved-changes dialog is showing. */
  protected readonly leavePrompt = signal(false);
  /** The one outstanding "may I leave?" answer; further attempts share it instead of stacking prompts. */
  private pendingLeave: { promise: Promise<boolean>; resolve: (leave: boolean) => void } | null =
    null;

  /**
   * Called by {@link canDeactivateForgeDocumentEditor}. A clean editor may be left at once; a dirty one
   * asks through Forge's confirmation dialog (Angular awaits the returned promise). Stay → `false`,
   * the editor and every value stay; Leave → `true`.
   */
  canDeactivate(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    if (this.pendingLeave !== null) return this.pendingLeave.promise;

    let resolve!: (leave: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    this.pendingLeave = { promise, resolve };
    this.leavePrompt.set(true);
    return promise;
  }

  protected answerLeave(leave: boolean): void {
    const pending = this.pendingLeave;
    this.pendingLeave = null;
    this.leavePrompt.set(false);
    pending?.resolve(leave);
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
