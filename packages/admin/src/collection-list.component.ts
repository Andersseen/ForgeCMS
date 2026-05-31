import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CollectionDefinition } from '@forge-cms/core';

@Component({
  selector: 'forge-collection-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-collection-list">
      <h2>{{ collection()?.slug ?? 'Collection' }}</h2>
      <p class="text-muted">Collection list component is not yet implemented.</p>
    </div>
  `
})
export class ForgeCollectionListComponent {
  readonly collection = input<CollectionDefinition>();
}
