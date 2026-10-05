import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { features, localApiCode } from '../landing-data';

@Component({
  selector: 'forge-cms-architecture-section',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="architecture" class="border-y border-border bg-background">
      <div class="mx-auto w-full max-w-7xl px-5 py-22 md:px-8 md:py-28">
        <div class="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-18">
          <div>
            <p class="forge-section-mark">Built around your content</p>
            <h2 class="forge-section-title mt-5">One model. A whole content system.</h2>
            <p class="mt-5 max-w-[46ch] leading-7 text-muted-foreground">
              One collection definition drives validation, persistence, access rules, REST, the
              Local API and the Angular admin. Start with your content. The rest of the system
              follows.
            </p>
          </div>

          <div class="border-t border-border">
            @for (feature of features; track feature.title) {
              <article
                class="grid gap-2 border-b border-border py-5 sm:grid-cols-[0.7fr_1.3fr] sm:gap-8"
              >
                <h3 class="font-semibold tracking-[-0.015em]">{{ feature.title }}</h3>
                <p class="text-sm leading-6 text-muted-foreground">{{ feature.description }}</p>
              </article>
            }
          </div>
        </div>

        <div
          class="mt-20 grid overflow-hidden rounded-[1.4rem] border border-border forge-themed-panel lg:grid-cols-[0.82fr_1.18fr]"
        >
          <div class="flex flex-col justify-between p-7 md:p-10">
            <div>
              <p class="text-sm font-medium text-primary">No internal HTTP hop</p>
              <h3 class="mt-4 max-w-[14ch] text-3xl font-semibold leading-tight tracking-[-0.04em]">
                Compose content where your server code already lives.
              </h3>
              <p class="mt-5 max-w-[48ch] leading-7 text-muted-foreground">
                The Local API calls the same access, hooks, drafts, validation and relation pipeline
                as REST. It returns the payload your route needs without making your app call
                itself.
              </p>
            </div>
            <a voltButton variant="outline" class="mt-8 w-fit" routerLink="/docs/local-api">
              Read the Local API guide
              <lmn-arrow-right [size]="16" />
            </a>
          </div>
          <pre class="forge-code m-3 overflow-x-auto md:m-5"><code>{{ localApiCode }}</code></pre>
        </div>
      </div>
    </section>
  `
})
export class ArchitectureSectionComponent {
  protected readonly features = features;
  protected readonly localApiCode = localApiCode;
}
