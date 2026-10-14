import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { localizationExample } from '../landing-data';

@Component({
  selector: 'forge-cms-localization-section',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="localization"
      class="mx-auto w-full max-w-7xl px-5 py-18 md:px-8 md:py-22"
      aria-labelledby="localization-title"
    >
      <div class="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <p class="forge-section-mark">For real client sites</p>
          <h2 id="localization-title" class="forge-section-title mt-5">
            Spanish and English, side by side.
          </h2>
          <ul class="mt-6 space-y-3 text-sm leading-6">
            @for (point of example.points; track point) {
              <li class="flex gap-2.5">
                <span
                  class="mt-[0.6rem] size-1.5 shrink-0 rounded-full bg-primary"
                  aria-hidden="true"
                ></span>
                <span>{{ point }}</span>
              </li>
            }
          </ul>
          <p class="mt-5 text-sm leading-6 text-muted-foreground">{{ example.limits }}</p>
          <a voltButton variant="outline" class="mt-7" routerLink="/docs/collections">
            Localization guide
            <lmn-arrow-right [size]="16" />
          </a>
        </div>

        <div class="grid gap-4 md:grid-cols-[1.05fr_0.95fr]">
          <pre class="forge-code m-0" tabindex="0"><code>{{ example.schema }}</code></pre>
          <div
            class="forge-themed-panel rounded-[1.1rem] border border-border p-5"
            role="group"
            aria-label="Illustrative admin view: one document, two locales"
          >
            <p class="text-xs font-medium text-muted-foreground">
              Illustrative · the admin edits one locale at a time
            </p>
            @for (locale of example.locales; track locale.code) {
              <div
                class="mt-4 border-t border-border pt-4 first-of-type:border-t-0 first-of-type:pt-0"
              >
                <span class="forge-locale-chip">{{ locale.code }}</span>
                <dl class="mt-3 space-y-2 text-sm">
                  <div class="grid grid-cols-[6rem_1fr] gap-3">
                    <dt class="text-muted-foreground">Title</dt>
                    <dd class="font-medium">{{ locale.title }}</dd>
                  </div>
                  <div class="grid grid-cols-[6rem_1fr] gap-3">
                    <dt class="text-muted-foreground">Description</dt>
                    <dd>{{ locale.description }}</dd>
                  </div>
                </dl>
              </div>
            }
          </div>
        </div>
      </div>
    </section>
  `
})
export class LocalizationSectionComponent {
  protected readonly example = localizationExample;
}
