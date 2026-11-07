import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/** An independent, purely browser-side island: a reader preference that needs no server call at all. */
@Component({
  selector: 'reading-size-island',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button
    type="button"
    data-reading-size
    [attr.aria-pressed]="large()"
    (click)="toggle()"
  >
    {{ large() ? 'Standard text' : 'Larger text' }}
  </button>`
})
export class ReadingSizeIsland {
  /** Public label of the article this preference applies to. */
  readonly articleTitle = input.required<string>();
  protected readonly large = signal(false);

  protected toggle(): void {
    this.large.update((value) => !value);
    document.documentElement.dataset['readingSize'] = this.large() ? 'large' : 'standard';
  }
}
