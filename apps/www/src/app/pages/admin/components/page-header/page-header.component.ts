import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'forge-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="text-sm text-muted-foreground mt-1">{{ subtitle() }}</p>
        }
      </div>
      @if (hasActions()) {
        <div class="flex items-center gap-2">
          <ng-content select="[actions]" />
        </div>
      }
    </div>
  `
})
export class PageHeaderComponent {
  title = input.required<string>();
  subtitle = input<string>();

  hasActions(): boolean {
    // Angular doesn't provide a direct way to check ng-content presence
    // Pages always include actions wrapper when needed, so this is fine
    return true;
  }
}
