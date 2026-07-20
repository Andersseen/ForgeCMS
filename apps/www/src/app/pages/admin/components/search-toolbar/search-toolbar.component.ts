import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { VoltInput } from '@voltui/components';

@Component({
  selector: 'forge-search-toolbar',
  standalone: true,
  imports: [VoltInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-3">
      <volt-input [placeholder]="placeholder()" class="w-72 h-9 text-sm" />
      <ng-content select="[filters]" />
    </div>
  `
})
export class SearchToolbarComponent {
  placeholder = input('Search...');
}
