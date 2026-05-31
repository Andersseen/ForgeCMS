import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { VoltCard, VoltSeparator } from '@voltui/components';

@Component({
  selector: 'forge-settings-card',
  standalone: true,
  imports: [VoltCard, VoltSeparator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <volt-card class="p-6 space-y-4">
      <div class="flex items-center gap-3">
        <div
          class="h-9 w-9 rounded-lg flex items-center justify-center"
          [class.bg-primary/10]="iconColor() === 'primary'"
          [class.text-primary]="iconColor() === 'primary'"
          [class.bg-info/10]="iconColor() === 'info'"
          [class.text-info]="iconColor() === 'info'"
          [class.bg-warning/10]="iconColor() === 'warning'"
          [class.text-warning]="iconColor() === 'warning'"
          [class.bg-success/10]="iconColor() === 'success'"
          [class.text-success]="iconColor() === 'success'"
          [class.bg-destructive/10]="iconColor() === 'destructive'"
          [class.text-destructive]="iconColor() === 'destructive'"
        >
          <ng-content select="[icon]" />
        </div>
        <div>
          <h2 class="font-semibold">{{ title() }}</h2>
          <p class="text-xs text-muted-foreground">{{ subtitle() }}</p>
        </div>
      </div>
      <volt-separator />
      <ng-content />
    </volt-card>
  `
})
export class SettingsCardComponent {
  title = input.required<string>();
  subtitle = input.required<string>();
  iconColor = input<
    'primary' | 'info' | 'warning' | 'success' | 'destructive'
  >('primary');
}
