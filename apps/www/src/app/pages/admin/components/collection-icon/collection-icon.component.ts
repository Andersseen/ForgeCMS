import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  IconFileText,
  IconGlobe,
  IconImage,
  IconNewspaper,
  IconUsers
} from '../../../../components/icons';

@Component({
  selector: 'forge-collection-icon',
  standalone: true,
  imports: [IconGlobe, IconNewspaper, IconImage, IconUsers, IconFileText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (name()) {
      @case ('globe') {
        <icon-globe [class]="iconClass()" />
      }
      @case ('newspaper') {
        <icon-newspaper [class]="iconClass()" />
      }
      @case ('image') {
        <icon-image [class]="iconClass()" />
      }
      @case ('users') {
        <icon-users [class]="iconClass()" />
      }
      @default {
        <icon-file-text [class]="iconClass()" />
      }
    }
  `
})
export class CollectionIconComponent {
  name = input.required<string>();
  iconClass = input('h-4 w-4');
}
