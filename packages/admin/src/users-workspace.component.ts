import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  VoltButton,
  VoltCard,
  VoltError,
  VoltInput,
  VoltLabel,
  VoltTable,
  VoltTableBody,
  VoltTableCell,
  VoltTableHead,
  VoltTableHeader,
  VoltTableRow
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
    VoltLabel,
    VoltError,
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
            <volt-button size="sm" (click)="startCreate()">
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

          <div class="space-y-4">
            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-1.5">
                <volt-label htmlFor="forge-user-name">Name</volt-label>
                <volt-input
                  id="forge-user-name"
                  [value]="form().name"
                  (valueChange)="update('name', $event)"
                />
              </div>
              <div class="space-y-1.5">
                <volt-label htmlFor="forge-user-email">Email</volt-label>
                <volt-input
                  id="forge-user-email"
                  type="email"
                  [value]="form().email"
                  (valueChange)="update('email', $event)"
                />
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-1.5">
                <volt-label htmlFor="forge-user-role">Role</volt-label>
                <select
                  id="forge-user-role"
                  class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  [value]="form().role"
                  [disabled]="isEditingSoleAdmin()"
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
                <volt-label htmlFor="forge-user-password">
                  {{ editingUser() ? 'New password (leave blank to keep)' : 'Password' }}
                </volt-label>
                <volt-input
                  id="forge-user-password"
                  type="password"
                  autocomplete="new-password"
                  [value]="form().password"
                  (valueChange)="update('password', $event)"
                />
              </div>
            </div>

            @if (formError(); as message) {
              <volt-error role="alert">{{ message }}</volt-error>
            }

            <div class="flex items-center justify-end gap-2 pt-2">
              <volt-button type="button" variant="outline" size="sm" (click)="cancelForm()">
                Cancel
              </volt-button>
              <volt-button type="button" size="sm" (click)="onSubmit($event)">
                {{ editingUser() ? 'Save' : 'Create' }}
              </volt-button>
            </div>
          </div>
        </volt-card>
      }

      @if (!isAdmin()) {
        <forge-error-state
          title="Access denied"
          message="You don't have permission to manage users."
          [showRetry]="false"
        />
      } @else if (loading()) {
        <forge-loading-state variant="table" />
      } @else if (error()) {
        <forge-error-state title="Unable to load users" [message]="error()" (retry)="load()" />
      } @else {
        <volt-card class="overflow-hidden">
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
                      <volt-button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        [disabled]="isSoleAdmin(user)"
                        [title]="isSoleAdmin(user) ? 'The only admin can\\'t be deleted' : ''"
                        (click)="requestDelete(user)"
                      >
                        <lmn-trash [size]="14" />
                        <span class="sr-only">
                          {{
                            isSoleAdmin(user)
                              ? 'Cannot delete the only admin'
                              : 'Delete ' + (user.name || user.email)
                          }}
                        </span>
                      </volt-button>
                    </div>
                  </volt-table-cell>
                </volt-table-row>
              }
            </volt-table-body>
          </volt-table>
        </volt-card>
      }
    </div>

    <forge-confirm-dialog
      [open]="deleteTarget() !== null"
      title="Delete this user?"
      [message]="deleteMessage()"
      (confirm)="confirmDelete()"
      (cancel)="cancelDelete()"
    />
  `
})
export class ForgeUsersWorkspaceComponent {
  private readonly api = inject(CmsApiService);
  private readonly session = inject(ForgeAuthSession);

  readonly users = signal<AuthUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly isAdmin = computed(() => canManageUsers(this.session.user()));
  readonly showForm = signal(false);
  readonly editingUser = signal<AuthUser | null>(null);
  readonly form = signal<UserFormValue>(emptyForm());
  readonly formError = signal<string | null>(null);
  readonly deleteTarget = signal<AuthUser | null>(null);

  private readonly adminCount = computed(
    () => this.users().filter((user) => userRole(user) === 'admin').length
  );

  readonly isEditingSoleAdmin = computed(() => {
    const editing = this.editingUser();
    return editing !== null && this.isSoleAdmin(editing);
  });

  readonly deleteMessage = computed(() => {
    const target = this.deleteTarget();
    return target ? `Delete user ${target.email}? This cannot be undone.` : '';
  });

  constructor() {
    void this.load();
  }

  isSelf(user: AuthUser): boolean {
    return user.id === this.session.user()?.id;
  }

  /** True when `user` is an admin and no other admin exists — the last-admin invariant's UI mirror. */
  isSoleAdmin(user: AuthUser): boolean {
    return userRole(user) === 'admin' && this.adminCount() === 1;
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const users = await this.api.getUsers();
      this.users.set(users);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      this.loading.set(false);
    }
  }

  startCreate(): void {
    this.editingUser.set(null);
    this.form.set(emptyForm());
    this.formError.set(null);
    this.showForm.set(true);
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
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editingUser.set(null);
    this.form.set(emptyForm());
    this.formError.set(null);
  }

  update(field: keyof UserFormValue, value: string): void {
    this.form.update((current) => ({ ...current, [field]: value }));
  }

  onRoleChange(event: Event): void {
    this.update('role', (event.target as HTMLSelectElement).value as UserFormValue['role']);
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
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

    try {
      if (editing) {
        await this.api.updateUser(editing.id, input);
      } else {
        await this.api.createUser(input as CreateUserInput);
      }
      this.cancelForm();
      await this.load();
    } catch (err) {
      this.formError.set(err instanceof Error ? err.message : 'Failed to save user');
    }
  }

  requestDelete(user: AuthUser): void {
    this.deleteTarget.set(user);
  }

  cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  async confirmDelete(): Promise<void> {
    const user = this.deleteTarget();
    if (!user) return;
    this.deleteTarget.set(null);
    try {
      await this.api.deleteUser(user.id);
      await this.load();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }
}
