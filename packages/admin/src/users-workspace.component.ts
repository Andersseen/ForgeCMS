import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { afterNextRenderIfAlive } from './after-render.js';
import {
  VoltButton,
  VoltCard,
  VoltInput,
  VoltTable,
  VoltTableBody,
  VoltTableCell,
  VoltTableHead,
  VoltTableHeader,
  VoltTableRow,
  buttonVariants
} from '@voltui/components';
import { LmnPencilIcon, LmnPlusIcon, LmnTrashIcon, LmnUsersIcon } from 'lumen-icons';
import {
  CmsApiService,
  ForgeAuthSession,
  canManageUsers,
  userRole,
  type AuthUser,
  type CreateUserInput
} from '@forge-cms/angular';
import { ErrorStateComponent } from './error-state.component.js';
import { LoadingStateComponent } from './loading-state.component.js';
import { PageHeaderComponent } from './page-header.component.js';
import { ForgeConfirmDialogComponent } from './confirm-dialog.component.js';
import { describeAdminError, isForbiddenError } from './admin-error.js';

interface UserFormValue {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'editor' | 'viewer';
}

function emptyForm(): UserFormValue {
  return { name: '', email: '', password: '', role: 'viewer' };
}

/**
 * Reusable users-management workspace for `@forge-cms/admin` consumers (spec 054), ported from
 * `apps/www`'s app-local `UsersPage`. Already hits the dedicated `/api/auth/users*` primitives
 * (`CmsApiService.getUsers/createUser/updateUser/deleteUser`), never the generic collection
 * editor — `passwordHash` has no path to reach this component (audited in spec 054).
 *
 * Adds last-admin UX on top of the ported behavior: the server (`UsersCollectionAuthAdapter`,
 * spec 054) is the real backstop, but disabling the sole admin's own delete/demote controls here
 * avoids a round trip to discover an action was always going to fail.
 */
@Component({
  selector: 'forge-users-workspace',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    VoltInput,

    VoltTable,
    VoltTableHeader,
    VoltTableBody,
    VoltTableRow,
    VoltTableHead,
    VoltTableCell,
    LmnPlusIcon,
    LmnPencilIcon,
    LmnTrashIcon,
    LmnUsersIcon,
    PageHeaderComponent,
    ErrorStateComponent,
    LoadingStateComponent,
    ForgeConfirmDialogComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header title="Users" subtitle="Manage team members and their roles.">
        <div actions>
          @if (!showForm()) {
            <volt-button data-forge-new size="sm" (click)="startCreate()">
              <lmn-plus [size]="14" class="mr-1.5" />
              New User
            </volt-button>
          }
        </div>
      </forge-page-header>

      @if (showForm()) {
        <volt-card class="p-6 space-y-4">
          <h2 class="text-lg font-semibold">
            {{ editingUser() ? 'Edit user' : 'New user' }}
          </h2>

          <!-- A real form: Enter submits through the same guarded onSubmit as the button. -->
          <form class="space-y-4" novalidate (submit)="onSubmit($event)">
            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-1.5">
                <label
                  for="forge-user-name"
                  class="text-sm font-medium leading-none text-foreground"
                  >Name</label
                >
                <volt-input
                  [id]="'forge-user-name'"
                  [value]="form().name"
                  (valueChange)="update('name', $event)"
                />
              </div>
              <div class="space-y-1.5">
                <label
                  for="forge-user-email"
                  class="text-sm font-medium leading-none text-foreground"
                  >Email</label
                >
                <volt-input
                  [id]="'forge-user-email'"
                  type="email"
                  [value]="form().email"
                  (valueChange)="update('email', $event)"
                />
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-1.5">
                <label
                  for="forge-user-role"
                  class="text-sm font-medium leading-none text-foreground"
                  >Role</label
                >
                <select
                  id="forge-user-role"
                  class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  [value]="form().role"
                  [attr.aria-disabled]="isEditingSoleAdmin() ? 'true' : null"
                  [attr.aria-describedby]="isEditingSoleAdmin() ? 'forge-user-role-hint' : null"
                  (change)="onRoleChange($event)"
                >
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                @if (isEditingSoleAdmin()) {
                  <p id="forge-user-role-hint" class="text-xs text-muted-foreground">
                    This is the only admin — their role can't be changed until another admin exists.
                  </p>
                }
              </div>
              <div class="space-y-1.5">
                <label
                  for="forge-user-password"
                  class="text-sm font-medium leading-none text-foreground"
                >
                  {{ editingUser() ? 'New password (leave blank to keep)' : 'Password' }}
                </label>
                <volt-input
                  [id]="'forge-user-password'"
                  type="password"
                  autocomplete="new-password"
                  [value]="form().password"
                  (valueChange)="update('password', $event)"
                />
              </div>
            </div>

            @if (formError(); as message) {
              <p class="text-sm font-medium text-error" role="alert">{{ message }}</p>
            }
            <p class="sr-only" role="status">{{ saving() ? 'Saving…' : '' }}</p>

            <div class="flex items-center justify-end gap-2 pt-2">
              <volt-button
                type="button"
                variant="outline"
                size="sm"
                [disabled]="saving()"
                (click)="onCancelClick()"
              >
                Cancel
              </volt-button>
              <volt-button type="submit" size="sm" [disabled]="saving() || !isAdmin()">
                {{ saving() ? 'Saving…' : editingUser() ? 'Save' : 'Create' }}
              </volt-button>
            </div>
          </form>
        </volt-card>
      }

      @if (hasSoleAdmin()) {
        <p id="forge-sole-admin-hint" class="text-xs text-muted-foreground">
          The only admin can't be deleted or demoted until another admin exists.
        </p>
      }

      @if (session.loading() && !isAdmin()) {
        <forge-loading-state variant="table" />
      } @else if (!isAdmin()) {
        @if (session.expired()) {
          <forge-error-state
            title="Session expired"
            message="Your session expired. Sign in again to manage users."
            [showRetry]="false"
          />
        } @else {
          <forge-error-state
            title="Access denied"
            message="You don't have permission to manage users."
            [showRetry]="false"
          />
        }
      } @else if (loading()) {
        <forge-loading-state variant="table" />
      } @else if (error()) {
        <forge-error-state title="Unable to load users" [message]="error()" (retry)="load()" />
      } @else {
        <volt-card class="overflow-hidden">
          <div class="relative w-full overflow-x-auto">
            <volt-table aria-label="Users">
              <volt-table-header>
                <volt-table-row>
                  <volt-table-head>Name</volt-table-head>
                  <volt-table-head>Email</volt-table-head>
                  <volt-table-head>Role</volt-table-head>
                  <volt-table-head class="text-right">Actions</volt-table-head>
                </volt-table-row>
              </volt-table-header>
              <volt-table-body>
                @for (user of users(); track user.id) {
                  <volt-table-row>
                    <volt-table-cell>
                      <div class="flex items-center gap-3">
                        <lmn-users [size]="16" class="text-muted-foreground" />
                        <span class="font-medium">
                          {{ user.name || 'Unknown' }}
                          @if (isSelf(user)) {
                            <span class="text-xs text-muted-foreground">(you)</span>
                          }
                        </span>
                      </div>
                    </volt-table-cell>
                    <volt-table-cell>{{ user.email }}</volt-table-cell>
                    <volt-table-cell>
                      <span
                        class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium"
                      >
                        {{ user.role || 'viewer' }}
                      </span>
                    </volt-table-cell>
                    <volt-table-cell class="text-right">
                      <div class="flex items-center justify-end gap-1">
                        <volt-button
                          variant="ghost"
                          size="icon"
                          class="h-7 w-7"
                          (click)="startEdit(user)"
                        >
                          <lmn-pencil [size]="14" />
                          <span class="sr-only">Edit {{ user.name || user.email }}</span>
                        </volt-button>
                        <!-- Focusable on purpose: a disabled button can't be reached by keyboard, so the
                             reason (the last-admin rule) would only exist for a mouse hover. The server
                             still refuses it; this only avoids a round trip. -->
                        <button
                          type="button"
                          [class]="deleteButtonClass(user)"
                          [attr.aria-disabled]="isSoleAdmin(user) ? 'true' : null"
                          [attr.aria-describedby]="
                            isSoleAdmin(user) ? 'forge-sole-admin-hint' : null
                          "
                          (click)="requestDelete(user)"
                        >
                          <lmn-trash [size]="14" />
                          <span class="sr-only">Delete {{ user.name || user.email }}</span>
                        </button>
                      </div>
                    </volt-table-cell>
                  </volt-table-row>
                }
              </volt-table-body>
            </volt-table>
          </div>
        </volt-card>
      }
    </div>

    <forge-confirm-dialog
      [open]="deleteTarget() !== null"
      title="Delete this user?"
      [message]="deleteMessage()"
      [pending]="deleting()"
      [error]="deleteError()"
      (confirm)="confirmDelete()"
      (cancel)="cancelDelete()"
    />
  `
})
export class ForgeUsersWorkspaceComponent {
  private readonly api = inject(CmsApiService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef, { optional: true });
  protected readonly session = inject(ForgeAuthSession);

  readonly users = signal<AuthUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly isAdmin = computed(() => canManageUsers(this.session.user()));
  readonly showForm = signal(false);
  readonly editingUser = signal<AuthUser | null>(null);
  readonly form = signal<UserFormValue>(emptyForm());
  readonly formError = signal<string | null>(null);
  readonly deleteTarget = signal<AuthUser | null>(null);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  /** Latest-wins: only the newest `load()` may commit, and starting one aborts the previous. */
  private loadToken = 0;
  /** Bumped when admin permission is lost: outcomes of earlier mutations are then discarded. */
  private mutationEpoch = 0;
  private loadAbort: AbortController | null = null;

  private readonly adminCount = computed(
    () => this.users().filter((user) => userRole(user) === 'admin').length
  );

  readonly hasSoleAdmin = computed(() => this.users().some((user) => this.isSoleAdmin(user)));

  readonly isEditingSoleAdmin = computed(() => {
    const editing = this.editingUser();
    return editing !== null && this.isSoleAdmin(editing);
  });

  readonly deleteMessage = computed(() => {
    const target = this.deleteTarget();
    return target ? `Delete user ${target.email}? This cannot be undone.` : '';
  });

  constructor() {
    // The live session decides whether this workspace is actionable. Admin → load the users; the
    // moment the server says otherwise (demotion, expiry) drop the rows and any open form/dialog so
    // nothing admin-only stays on screen as something to act on. The server remains the authority.
    effect(() => {
      const admin = this.isAdmin();
      untracked(() => {
        if (admin) {
          void this.load();
          return;
        }
        this.loadAbort?.abort();
        this.loadToken++;
        this.mutationEpoch++;
        this.users.set([]);
        this.loading.set(false);
        this.error.set(null);
        this.deleteTarget.set(null);
        this.deleteError.set(null);
        this.deleting.set(false);
        this.saving.set(false);
        // An expired session keeps the half-typed form (nothing is lost by waiting for sign-in);
        // a demotion has nothing left to save it to.
        if (!this.session.expired()) this.cancelForm();
      });
    });
  }

  isSelf(user: AuthUser): boolean {
    return user.id === this.session.user()?.id;
  }

  /** Volt's ghost/icon look on a native button, dimmed when the last-admin rule applies. */
  protected deleteButtonClass(user: AuthUser): string {
    const base = `${buttonVariants({ variant: 'ghost', size: 'icon' })} h-7 w-7`;
    return this.isSoleAdmin(user) ? `${base} cursor-not-allowed opacity-50` : base;
  }

  /** True when `user` is an admin and no other admin exists — the last-admin invariant's UI mirror. */
  isSoleAdmin(user: AuthUser): boolean {
    return userRole(user) === 'admin' && this.adminCount() === 1;
  }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;

    this.loading.set(true);
    this.error.set(null);
    try {
      const users = await this.api.getUsers({ signal: abort.signal });
      if (token !== this.loadToken) return;
      this.users.set(users);
    } catch (err) {
      if (token !== this.loadToken) return;
      if (isForbiddenError(err)) void this.session.refresh();
      this.error.set(describeAdminError(err));
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
  }

  startCreate(): void {
    this.editingUser.set(null);
    this.form.set(emptyForm());
    this.formError.set(null);
    this.showForm.set(true);
    this.focusAfterRender('#forge-user-name');
  }

  startEdit(user: AuthUser): void {
    this.editingUser.set(user);
    this.form.set({
      name: user.name ?? '',
      email: user.email ?? '',
      password: '',
      role: (user.role as 'admin' | 'editor' | 'viewer') ?? 'viewer'
    });
    this.formError.set(null);
    this.showForm.set(true);
    this.focusAfterRender('#forge-user-name');
  }

  /** Moves focus once the form (or the page again) has rendered; the control that had it is gone. */
  private focusAfterRender(selector: string): void {
    afterNextRenderIfAlive(this.injector, this.destroyRef, () => {
      this.host?.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }

  cancelForm(): void {
    if (this.saving()) return;
    this.showForm.set(false);
    this.editingUser.set(null);
    this.form.set(emptyForm());
    this.formError.set(null);
  }

  /** Cancel is a deliberate choice: the form closes and focus goes back to "New User". */
  protected onCancelClick(): void {
    if (this.saving()) return;
    this.cancelForm();
    this.focusAfterRender('[data-forge-new] button');
  }

  update(field: keyof UserFormValue, value: string): void {
    this.form.update((current) => ({ ...current, [field]: value }));
  }

  onRoleChange(event: Event): void {
    if (this.isEditingSoleAdmin()) {
      // The only admin keeps the role; the control stays focusable so the reason can be read.
      (event.target as HTMLSelectElement).value = this.form().role;
      return;
    }
    this.update('role', (event.target as HTMLSelectElement).value as UserFormValue['role']);
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving() || !this.isAdmin()) return;
    this.formError.set(null);

    const current = this.form();
    const editing = this.editingUser();

    if (!current.email || (!editing && !current.password)) {
      this.formError.set('Email and password are required.');
      return;
    }

    const input: Partial<CreateUserInput> & { email: string } = {
      email: current.email,
      name: current.name,
      role: current.role
    };

    if (current.password) {
      input.password = current.password;
    }

    const epoch = this.mutationEpoch;
    this.saving.set(true);
    try {
      if (editing) {
        await this.api.updateUser(editing.id, input);
      } else {
        await this.api.createUser(input as CreateUserInput);
      }
    } catch (err) {
      if (epoch !== this.mutationEpoch) return;
      // Nothing was saved: the form stays exactly as typed so the editor can correct and retry.
      if (isForbiddenError(err)) void this.session.refresh();
      this.formError.set(describeAdminError(err));
      this.saving.set(false);
      return;
    }

    if (epoch !== this.mutationEpoch) return;
    this.saving.set(false);
    this.cancelForm();
    this.focusAfterRender('h1');
    // Changing the signed-in user's own role/password changes what the server will let them do next.
    if (editing && this.isSelf(editing)) void this.session.refresh();
    await this.load();
  }

  requestDelete(user: AuthUser): void {
    if (this.deleting() || this.isSoleAdmin(user)) return;
    this.deleteError.set(null);
    this.deleteTarget.set(user);
  }

  cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteTarget.set(null);
    this.deleteError.set(null);
  }

  async confirmDelete(): Promise<void> {
    const user = this.deleteTarget();
    if (!user || this.deleting()) return;

    const epoch = this.mutationEpoch;
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.api.deleteUser(user.id);
    } catch (err) {
      if (epoch !== this.mutationEpoch) return;
      // Not deleted: keep the dialog (and the row) so confirming again is the retry. A refused
      // last-admin delete (409) keeps the server's own message.
      if (isForbiddenError(err)) void this.session.refresh();
      this.deleteError.set(describeAdminError(err));
      this.deleting.set(false);
      return;
    }

    if (epoch !== this.mutationEpoch) return;
    this.deleting.set(false);
    this.deleteTarget.set(null);
    // The row that opened the dialog is gone: land on the page heading.
    this.focusAfterRender('h1');
    await this.load();
  }
}
