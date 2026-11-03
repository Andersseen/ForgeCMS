import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MessagePart } from '@etyma/core';
import { messageSegments } from '../i18n/message-segments';

/**
 * Renders a translated message that carries inline markup (`{#code}`, `{#strong}`, `{#link}`, or a
 * named external link from `hrefs`) as real elements. The host is `display: contents`, so it sits in running text like the markup did.
 */
@Component({
  selector: 'forge-cms-rich-message',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `@for (segment of segments(); track $index) {
    @switch (segment.tag) {
      @case ('code') {
        <code>{{ segment.text }}</code>
      }
      @case ('strong') {
        <strong [class]="strongClass()">{{ segment.text }}</strong>
      }
      @case ('link') {
        <a [routerLink]="link()">{{ segment.text }}</a>
      }
      @default {
        @if (segment.tag && hrefs()[segment.tag]; as href) {
          <a [href]="href">{{ segment.text }}</a>
        } @else {
          <span>{{ segment.text }}</span>
        }
      }
    }
  }`
})
export class RichMessageComponent {
  readonly parts = input.required<readonly MessagePart[]>();
  /** Where `{#link}` points (an in-app path). */
  readonly link = input<string>('/');
  readonly strongClass = input<string>('');
  /** External links by markup name: `{#aepd}…{/aepd}` → `hrefs.aepd`. */
  readonly hrefs = input<Readonly<Record<string, string>>>({});
  protected readonly segments = computed(() => messageSegments(this.parts()));
}
