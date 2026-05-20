import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  VoltAvatar,
  VoltAvatarFallback,
  VoltAvatarImage,
  VoltBadge,
  VoltButton,
  VoltCard,
  VoltInput,
  VoltSeparator,
} from '@voltui/components';
import {
  IconChevronDown,
  IconEdit,
  IconFilter,
  IconMail,
  IconMoreVertical,
  IconSearch,
  IconShield,
  IconUsers,
} from '../../../components/icons';

interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: 'super-admin' | 'admin' | 'editor' | 'developer' | 'viewer';
  status: 'active' | 'inactive' | 'invited';
  lastActive: string;
  documents: number;
  joined: string;
}

@Component({
  selector: 'forge-cms-users',
  standalone: true,
  imports: [
    VoltCard,
    VoltButton,
    VoltBadge,
    VoltAvatar,
    VoltAvatarImage,
    VoltAvatarFallback,
    VoltInput,
    VoltSeparator,
    IconSearch,
    IconFilter,
    IconUsers,
    IconShield,
    IconMail,
    IconEdit,
    IconMoreVertical,
    IconChevronDown,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
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

      <!-- User Stats -->
      <div class="grid gap-4 md:grid-cols-4">
        <volt-card class="p-4">
          <div class="flex items-center gap-3">
            <div class="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <icon-users class="h-4 w-4" />
            </div>
            <div>
              <p class="text-2xl font-bold">42</p>
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
              <p class="text-2xl font-bold">38</p>
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
              <p class="text-2xl font-bold">3</p>
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
              <p class="text-2xl font-bold">1</p>
              <p class="text-xs text-muted-foreground">Inactive</p>
            </div>
          </div>
        </volt-card>
      </div>

      <!-- Filters -->
      <div class="flex items-center gap-3">
        <volt-input placeholder="Search users..." class="w-72 h-9 text-sm" />
        <volt-button variant="outline" size="sm">
          <icon-filter class="h-3.5 w-3.5 mr-1.5" />
          All Roles
        </volt-button>
        <volt-button variant="outline" size="sm">Active</volt-button>
        <volt-button variant="outline" size="sm">Invited</volt-button>
      </div>

      <!-- Users Table -->
      <volt-card class="overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-muted/50">
              <tr class="border-b border-border">
                <th class="h-10 px-4 text-left font-medium text-muted-foreground">User</th>
                <th class="h-10 px-4 text-left font-medium text-muted-foreground">Role</th>
                <th class="h-10 px-4 text-left font-medium text-muted-foreground">Status</th>
                <th class="h-10 px-4 text-left font-medium text-muted-foreground">Documents</th>
                <th class="h-10 px-4 text-left font-medium text-muted-foreground">Last Active</th>
                <th class="h-10 px-4 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (user of users; track user.id) {
                <tr class="border-b border-border hover:bg-muted/30 transition-colors">
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                      <volt-avatar>
                        <img [src]="user.avatar" [alt]="user.name" voltAvatarImage />
                        <volt-avatar-fallback>{{ user.name.slice(0, 2).toUpperCase() }}</volt-avatar-fallback>
                      </volt-avatar>
                      <div>
                        <p class="font-medium">{{ user.name }}</p>
                        <p class="text-xs text-muted-foreground">{{ user.email }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    @switch (user.role) {
                      @case ('super-admin') {
                        <volt-badge variant="solid" class="text-[10px]">Super Admin</volt-badge>
                      }
                      @case ('admin') {
                        <volt-badge variant="secondary" class="text-[10px]">Admin</volt-badge>
                      }
                      @case ('editor') {
                        <volt-badge class="text-[10px]">Editor</volt-badge>
                      }
                      @case ('developer') {
                        <volt-badge variant="outline" class="text-[10px]">Developer</volt-badge>
                      }
                      @case ('viewer') {
                        <volt-badge variant="outline" class="text-[10px] text-muted-foreground">Viewer</volt-badge>
                      }
                    }
                  </td>
                  <td class="px-4 py-3">
                    @switch (user.status) {
                      @case ('active') {
                        <span class="inline-flex items-center gap-1.5">
                          <span class="h-1.5 w-1.5 rounded-full bg-success"></span>
                          <span class="text-xs text-muted-foreground">Active</span>
                        </span>
                      }
                      @case ('inactive') {
                        <span class="inline-flex items-center gap-1.5">
                          <span class="h-1.5 w-1.5 rounded-full bg-muted-foreground"></span>
                          <span class="text-xs text-muted-foreground">Inactive</span>
                        </span>
                      }
                      @case ('invited') {
                        <span class="inline-flex items-center gap-1.5">
                          <span class="h-1.5 w-1.5 rounded-full bg-warning"></span>
                          <span class="text-xs text-muted-foreground">Invited</span>
                        </span>
                      }
                    }
                  </td>
                  <td class="px-4 py-3">{{ user.documents }}</td>
                  <td class="px-4 py-3 text-muted-foreground">{{ user.lastActive }}</td>
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
    </div>
  `,
})
export class UsersPage {
  users: User[] = [
    {
      id: '1',
      name: 'Admin User',
      email: 'admin@forgecms.dev',
      avatar: 'https://i.pravatar.cc/150?u=admin',
      role: 'super-admin',
      status: 'active',
      lastActive: 'Just now',
      documents: 245,
      joined: 'Jan 1, 2024',
    },
    {
      id: '2',
      name: 'John Doe',
      email: 'john.doe@example.com',
      avatar: 'https://i.pravatar.cc/150?u=1',
      role: 'admin',
      status: 'active',
      lastActive: '2h ago',
      documents: 128,
      joined: 'Mar 15, 2024',
    },
    {
      id: '3',
      name: 'Sarah Miller',
      email: 'sarah.miller@example.com',
      avatar: 'https://i.pravatar.cc/150?u=2',
      role: 'editor',
      status: 'active',
      lastActive: '5h ago',
      documents: 89,
      joined: 'Jun 22, 2024',
    },
    {
      id: '4',
      name: 'Mike Kim',
      email: 'mike.kim@example.com',
      avatar: 'https://i.pravatar.cc/150?u=3',
      role: 'developer',
      status: 'active',
      lastActive: '1d ago',
      documents: 34,
      joined: 'Sep 10, 2024',
    },
    {
      id: '5',
      name: 'Anna Lee',
      email: 'anna.lee@example.com',
      avatar: 'https://i.pravatar.cc/150?u=4',
      role: 'editor',
      status: 'active',
      lastActive: '2d ago',
      documents: 67,
      joined: 'Nov 5, 2024',
    },
    {
      id: '6',
      name: 'Robert Johnson',
      email: 'robert.j@example.com',
      avatar: 'https://i.pravatar.cc/150?u=5',
      role: 'viewer',
      status: 'inactive',
      lastActive: '5d ago',
      documents: 12,
      joined: 'Dec 20, 2024',
    },
    {
      id: '7',
      name: 'Emily Chen',
      email: 'emily.chen@example.com',
      avatar: 'https://i.pravatar.cc/150?u=6',
      role: 'editor',
      status: 'invited',
      lastActive: '-',
      documents: 0,
      joined: 'May 18, 2026',
    },
    {
      id: '8',
      name: 'David Park',
      email: 'david.park@example.com',
      avatar: 'https://i.pravatar.cc/150?u=7',
      role: 'developer',
      status: 'invited',
      lastActive: '-',
      documents: 0,
      joined: 'May 18, 2026',
    },
  ];
}
