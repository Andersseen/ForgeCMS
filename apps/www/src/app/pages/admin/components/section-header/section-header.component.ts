import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'forge-section-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ title() }}</h2>
      <ng-content select="[actions]" />
    </div>
  `
})
export class SectionHeaderComponent {
  title = input.required<string>();
}
