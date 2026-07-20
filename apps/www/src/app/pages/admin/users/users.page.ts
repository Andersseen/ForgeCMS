import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
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
import { CmsApiService, type AuthUser, type CreateUserInput } from '@forge-cms/angular';
import { ErrorStateComponent, LoadingStateComponent, PageHeaderComponent } from '@forge-cms/admin';

interface UserFormValue {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'editor' | 'viewer';
}

function emptyForm(): UserFormValue {
  return { name: '', email: '', password: '', role: 'viewer' };
}

@Component({
  selector: 'forge-cms-users',
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
    LoadingStateComponent
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
                <volt-label htmlFor="user-name">Name</volt-label>
                <volt-input
                  id="user-name"
                  [value]="form().name"
                  (valueChange)="update('name', $event)"
                />
              </div>
              <div class="space-y-1.5">
                <volt-label htmlFor="user-email">Email</volt-label>
                <volt-input
                  id="user-email"
                  type="email"
                  [value]="form().email"
                  (valueChange)="update('email', $event)"
                />
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-1.5">
                <volt-label htmlFor="user-role">Role</volt-label>
                <select
                  id="user-role"
                  class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  [value]="form().role"
                  (change)="onRoleChange($event)"
                >
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div class="space-y-1.5">
                <volt-label htmlFor="user-password">
                  {{ editingUser() ? 'New password (leave blank to keep)' : 'Password' }}
                </volt-label>
                <volt-input
                  id="user-password"
                  type="password"
                  [value]="form().password"
                  (valueChange)="update('password', $event)"
                />
              </div>
            </div>

            @if (formError(); as message) {
              <volt-error>{{ message }}</volt-error>
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

      @if (loading()) {
        <forge-loading-state variant="table" />
      } @else if (error()) {
        <forge-error-state title="Unable to load users" [message]="error()" (retry)="load()" />
      } @else {
        <volt-card class="overflow-hidden">
          <volt-table>
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
                      <span class="font-medium">{{ user.name || 'Unknown' }}</span>
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
                      </volt-button>
                      <volt-button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        (click)="deleteUser(user)"
                      >
                        <lmn-trash [size]="14" />
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
  `
})
export class UsersPage implements OnInit {
  private api = inject(CmsApiService);

  readonly users = signal<AuthUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly showForm = signal(false);
  readonly editingUser = signal<AuthUser | null>(null);
  readonly form = signal<UserFormValue>(emptyForm());
  readonly formError = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
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

  async deleteUser(user: AuthUser): Promise<void> {
    if (!window.confirm(`Delete user ${user.email}? This cannot be undone.`)) return;
    try {
      await this.api.deleteUser(user.id);
      await this.load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }
}
