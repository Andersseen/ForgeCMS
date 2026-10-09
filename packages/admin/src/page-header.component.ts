import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'forge-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center justify-between">
      <div>
        <!-- tabindex -1: the stable place focus lands after an action removed the control that had it. -->
        <h1 tabindex="-1" class="text-2xl font-bold tracking-tight outline-none">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="text-sm text-muted-foreground mt-1">{{ subtitle() }}</p>
        }
      </div>
      <div class="flex items-center gap-2">
        <ng-content select="[actions]" />
      </div>
    </div>
  `
})
export class PageHeaderComponent {
  title = input.required<string>();
  subtitle = input<string>();
}
