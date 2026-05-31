import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { VoltCard } from '@voltui/components';

@Component({
  selector: 'forge-stat-card',
  standalone: true,
  imports: [VoltCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <volt-card class="p-4">
      @if (layout() === 'vertical') {
        <div class="flex items-center justify-between">
          <div class="space-y-1">
            <p class="text-sm text-muted-foreground">{{ label() }}</p>
            <p class="text-2xl font-bold">{{ value() }}</p>
            @if (sublabel()) {
              <div class="flex items-center gap-1 text-xs">
                <span class="text-muted-foreground">{{ sublabel() }}</span>
              </div>
            }
          </div>
          <div
            class="h-10 w-10 rounded-lg flex items-center justify-center"
            [class.bg-primary/10]="color() === 'primary'"
            [class.text-primary]="color() === 'primary'"
            [class.bg-success/10]="color() === 'success'"
            [class.text-success]="color() === 'success'"
            [class.bg-warning/10]="color() === 'warning'"
            [class.text-warning]="color() === 'warning'"
            [class.bg-info/10]="color() === 'info'"
            [class.text-info]="color() === 'info'"
            [class.bg-muted]="color() === 'muted'"
            [class.text-muted-foreground]="color() === 'muted'"
          >
            <ng-content select="[icon]" />
          </div>
        </div>
      } @else {
        <div class="flex items-center gap-3">
          <div
            class="h-9 w-9 rounded-lg flex items-center justify-center"
            [class.bg-primary/10]="color() === 'primary'"
            [class.text-primary]="color() === 'primary'"
            [class.bg-success/10]="color() === 'success'"
            [class.text-success]="color() === 'success'"
            [class.bg-warning/10]="color() === 'warning'"
            [class.text-warning]="color() === 'warning'"
            [class.bg-info/10]="color() === 'info'"
            [class.text-info]="color() === 'info'"
            [class.bg-muted]="color() === 'muted'"
            [class.text-muted-foreground]="color() === 'muted'"
          >
            <ng-content select="[icon]" />
          </div>
          <div>
            <p class="text-2xl font-bold">{{ value() }}</p>
            <p class="text-xs text-muted-foreground">{{ label() }}</p>
          </div>
        </div>
      }
    </volt-card>
  `
})
export class StatCardComponent {
  value = input.required<string | number>();
  label = input.required<string>();
  color = input<'primary' | 'success' | 'warning' | 'info' | 'muted'>('primary');
  layout = input<'vertical' | 'horizontal'>('vertical');
  sublabel = input<string>();
}
