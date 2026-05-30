import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import {
  VoltAvatar,
  VoltAvatarFallback,
  VoltBadge,
  VoltButton,
  VoltCard,
  VoltInput
} from '@voltui/components';
import {
  IconAlertCircle,
  IconEdit,
  IconFilter,
  IconMail,
  IconMoreVertical,
  IconShield,
  IconUsers
} from '../../../components/icons';
import { CmsApiService } from '@forge-cms/angular';

@Component({
  selector: 'forge-cms-users',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    VoltBadge,
    VoltAvatar,
    VoltAvatarFallback,
    VoltInput,
    IconFilter,
    IconUsers,
    IconShield,
    IconMail,
    IconEdit,
    IconMoreVertical,
    IconAlertCircle
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Users</h1>
          <p class="text-sm text-muted-foreground mt-1">Manage team members and their permissions.</p>
        </div>
        <div class="flex items-center gap-2">
          <volt-button variant="outline" size="sm">
            <icon-mail class="h-3.5 w-3.5 mr-1.5" />
            Invite
          </volt-button>
          <volt-button size="sm">
            <icon-users class="h-3.5 w-3.5 mr-1.5" />
            New User
          </volt-button>
        </div>
      </div>

      @if (loading()) {
        <div class="grid gap-4 md:grid-cols-4">
          @for (_ of [1,2,3,4]; track $index) {
            <volt-card class="p-4">
              <div class="animate-pulse flex items-center gap-3">
                <div class="h-9 w-9 rounded-lg bg-muted"></div>
                <div class="space-y-2">
                  <div class="h-5 bg-muted rounded w-12"></div>
                  <div class="h-3 bg-muted rounded w-20"></div>
                </div>
              </div>
            </volt-card>
          }
        </div>
        <volt-card class="overflow-hidden p-6">
          <div class="animate-pulse space-y-3">
            @for (_ of [1,2,3,4,5]; track $index) {
              <div class="h-10 bg-muted rounded"></div>
            }
          </div>
        </volt-card>
      } @else if (error()) {
        <volt-card class="p-8">
          <div class="text-center space-y-3">
            <div class="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <icon-alert-circle class="h-6 w-6" />
            </div>
            <h3 class="text-sm font-medium">Unable to load users</h3>
            <p class="text-xs text-muted-foreground max-w-sm mx-auto">{{ error() }}</p>
            <volt-button size="sm" (click)="loadUsers()">Retry</volt-button>
          </div>
        </volt-card>
      } @else if (users().length === 0) {
        <volt-card class="p-8">
          <div class="text-center space-y-3">
            <div class="h-12 w-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
              <icon-users class="h-6 w-6" />
            </div>
            <h3 class="text-sm font-medium">No users yet</h3>
            <p class="text-xs text-muted-foreground max-w-sm mx-auto">
              User management depends on your auth provider. Add users via your authentication microservice.
            </p>
          </div>
        </volt-card>
      } @else {
        <div class="grid gap-4 md:grid-cols-4">
          <volt-card class="p-4">
            <div class="flex items-center gap-3">
              <div class="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <icon-users class="h-4 w-4" />
              </div>
              <div>
                <p class="text-2xl font-bold">{{ users().length }}</p>
                <p class="text-xs text-muted-foreground">Total Users</p>
              </div>
            </div>
          </volt-card>
          <volt-card class="p-4">
            <div class="flex items-center gap-3">
              <div class="h-9 w-9 rounded-lg bg-success/10 text-success flex items-center justify-center">
                <icon-shield class="h-4 w-4" />
              </div>
              <div>
                <p class="text-2xl font-bold">{{ activeCount() }}</p>
                <p class="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </volt-card>
          <volt-card class="p-4">
            <div class="flex items-center gap-3">
              <div class="h-9 w-9 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
                <icon-mail class="h-4 w-4" />
              </div>
              <div>
                <p class="text-2xl font-bold">{{ invitedCount() }}</p>
                <p class="text-xs text-muted-foreground">Invited</p>
              </div>
            </div>
          </volt-card>
          <volt-card class="p-4">
            <div class="flex items-center gap-3">
              <div class="h-9 w-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
                <icon-users class="h-4 w-4" />
              </div>
              <div>
                <p class="text-2xl font-bold">{{ inactiveCount() }}</p>
                <p class="text-xs text-muted-foreground">Inactive</p>
              </div>
            </div>
          </volt-card>
        </div>

        <div class="flex items-center gap-3">
          <volt-input placeholder="Search users..." class="w-72 h-9 text-sm" />
          <volt-button variant="outline" size="sm">
            <icon-filter class="h-3.5 w-3.5 mr-1.5" />
            All Roles
          </volt-button>
        </div>

        <volt-card class="overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-muted/50">
                <tr class="border-b border-border">
                  <th class="h-10 px-4 text-left font-medium text-muted-foreground">User</th>
                  <th class="h-10 px-4 text-left font-medium text-muted-foreground">Role</th>
                  <th class="h-10 px-4 text-left font-medium text-muted-foreground">Status</th>
                  <th class="h-10 px-4 text-left font-medium text-muted-foreground">Last Login</th>
                  <th class="h-10 px-4 text-right font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (user of users(); track user.id) {
                  <tr class="border-b border-border hover:bg-muted/30 transition-colors">
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-3">
                        <volt-avatar>
                          <volt-avatar-fallback>{{ initials(user) }}</volt-avatar-fallback>
                        </volt-avatar>
                        <div>
                          <p class="font-medium">{{ user.name || 'Unknown' }}</p>
                          <p class="text-xs text-muted-foreground">{{ user.email }}</p>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <volt-badge variant="secondary" class="text-[10px]">{{ user.role || 'viewer' }}</volt-badge>
                    </td>
                    <td class="px-4 py-3">
                      <span class="inline-flex items-center gap-1.5">
                        <span class="h-1.5 w-1.5 rounded-full" [class.bg-success]="user.status === 'active'" [class.bg-muted-foreground]="user.status !== 'active'"></span>
                        <span class="text-xs text-muted-foreground">{{ user.status || 'active' }}</span>
                      </span>
                    </td>
                    <td class="px-4 py-3 text-muted-foreground">{{ user.lastLogin ? formatDate(user.lastLogin) : '—' }}</td>
                    <td class="px-4 py-3 text-right">
                      <div class="flex items-center justify-end gap-1">
                        <volt-button variant="ghost" size="icon" class="h-7 w-7">
                          <icon-edit class="h-3.5 w-3.5" />
                        </volt-button>
                        <volt-button variant="ghost" size="icon" class="h-7 w-7">
                          <icon-more-vertical class="h-3.5 w-3.5" />
                        </volt-button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </volt-card>
      }
    </div>
  `
})
export class UsersPage implements OnInit {
  private api = inject(CmsApiService);

  users = signal<Record<string, unknown>[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  activeCount = signal(0);
  invitedCount = signal(0);
  inactiveCount = signal(0);

  ngOnInit() {
    void this.loadUsers();
  }

  initials(user: Record<string, unknown>): string {
    const name = (user.name as string) || (user.email as string) || '?';
    return name.slice(0, 2).toUpperCase();
  }

  formatDate(value: unknown): string {
    try {
      return new Date(value as string).toLocaleString();
    } catch {
      return String(value);
    }
  }

  async loadUsers() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const docs = await this.api.getDocuments('users');
      this.users.set(docs);

      let active = 0;
      let invited = 0;
      let inactive = 0;
      for (const u of docs) {
        const status = (u.status as string) || 'active';
        if (status === 'active') active++;
        else if (status === 'invited') invited++;
        else if (status === 'inactive') inactive++;
      }
      this.activeCount.set(active);
      this.invitedCount.set(invited);
      this.inactiveCount.set(inactive);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      this.loading.set(false);
    }
  }
}
