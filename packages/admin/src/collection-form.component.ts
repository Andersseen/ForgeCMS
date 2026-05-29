import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CollectionDefinition } from '@forge-cms/core';

@Component({
  selector: 'forge-collection-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-collection-form">
      <h2>{{ collection()?.slug ?? 'Collection' }} — Form</h2>
      <p class="text-muted">Collection form component is not yet implemented.</p>
    </div>
  `
})
export class ForgeCollectionFormComponent {
  readonly collection = input<CollectionDefinition>();
}
