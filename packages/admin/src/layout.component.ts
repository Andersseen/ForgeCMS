import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ForgeAdminConfig } from './config.js';

@Component({
  selector: 'forge-admin-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-admin-layout">
      <header class="forge-admin-header">
        <h1>{{ config()?.title ?? 'ForgeCMS Admin' }}</h1>
      </header>
      <main class="forge-admin-main">
        <ng-content />
      </main>
    </div>
  `,
  styles: [
    `
      .forge-admin-layout {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
    `,
    `
      .forge-admin-header {
        padding: 1rem;
        border-bottom: 1px solid #e5e7eb;
      }
    `,
    `
      .forge-admin-main {
        flex: 1;
        padding: 1rem;
      }
    `
  ]
})
export class ForgeAdminLayoutComponent {
  readonly config = input<ForgeAdminConfig>();
}
