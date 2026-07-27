import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { CmsApiService, USER_ROLES, type AuthUser, type UserRole } from '@forge-cms/angular';
import { PageHeaderComponent } from '@forge-cms/admin';

@Component({
  selector: 'lumea-admin-users',
  standalone: true,
  imports: [PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <forge-page-header
        title="Staff accounts"
        subtitle="Admins manage everything; editors manage content and bookings; viewers are read-only."
      />

      <form
        class="grid gap-3 rounded-xl border border-border bg-card p-5 sm:grid-cols-[1fr_1fr_1fr_auto]"
        (submit)="create($event)"
      >
        <input
          placeholder="Name"
          [value]="name()"
          (input)="name.set(value($event))"
          class="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          placeholder="Email"
          type="email"
          required
          [value]="email()"
          (input)="email.set(value($event))"
          class="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          placeholder="Password"
          type="password"
          required
          [value]="password()"
          (input)="password.set(value($event))"
          class="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <div class="flex gap-2">
          <select
            [value]="role()"
            (change)="role.set(selectValue($event))"
            class="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            @for (option of roles; track option) {
              <option [value]="option">{{ option }}</option>
            }
          </select>
          <button
            type="submit"
            class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Add
          </button>
        </div>
      </form>

      @if (error(); as message) {
        <p class="text-sm text-destructive">{{ message }}</p>
      }

      <div class="overflow-hidden rounded-xl border border-border bg-card">
        <table class="w-full text-sm">
          <thead class="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th class="px-5 py-3">Name</th>
              <th class="px-5 py-3">Email</th>
              <th class="px-5 py-3">Role</th>
              <th class="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            @for (user of users(); track user.id) {
              <tr>
                <td class="px-5 py-3">{{ user.name }}</td>
                <td class="px-5 py-3 text-muted-foreground">{{ user.email }}</td>
                <td class="px-5 py-3">{{ user.role }}</td>
                <td class="px-5 py-3 text-right">
                  <button
                    type="button"
                    (click)="remove(user)"
                    class="text-xs text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="px-5 py-6 text-muted-foreground">No users.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `
})
export class AdminUsersPage implements OnInit {
  private readonly api = inject(CmsApiService);

  protected readonly roles = USER_ROLES;
  protected readonly users = signal<AuthUser[]>([]);
  protected readonly error = signal<string | null>(null);

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly role = signal<UserRole>('editor');

  ngOnInit(): void {
    void this.load();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected selectValue(event: Event): UserRole {
    return (event.target as HTMLSelectElement).value as UserRole;
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    try {
      await this.api.createUser({
        email: this.email(),
        password: this.password(),
        name: this.name(),
        role: this.role()
      });
      this.name.set('');
      this.email.set('');
      this.password.set('');
      await this.load();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not create the user');
    }
  }

  protected async remove(user: AuthUser): Promise<void> {
    if (!window.confirm(`Remove ${user.email}?`)) return;
    try {
      await this.api.deleteUser(user.id);
      await this.load();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not remove the user');
    }
  }

  private async load(): Promise<void> {
    try {
      this.users.set(await this.api.getUsers());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load users');
    }
  }
}
