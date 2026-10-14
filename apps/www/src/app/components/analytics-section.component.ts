import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { analyticsFacts } from '../landing-data';

@Component({
  selector: 'forge-cms-analytics-section',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="analytics"
      class="border-y border-border bg-background"
      aria-labelledby="analytics-title"
    >
      <div class="mx-auto w-full max-w-7xl px-5 py-18 md:px-8 md:py-22">
        <div class="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div
            class="forge-themed-panel order-2 rounded-[1.25rem] border border-border p-6 md:p-7 lg:order-1"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm font-medium">What the client sees</p>
              <p class="flex gap-1.5 text-xs" aria-label="Date ranges">
                @for (range of facts.ranges; track range) {
                  <span class="rounded-full border border-border px-2.5 py-1">{{ range }}</span>
                }
              </p>
            </div>
            <ul class="mt-5 grid gap-2 sm:grid-cols-2">
              @for (metric of facts.metrics; track metric) {
                <li class="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
                  {{ metric }}
                </li>
              }
            </ul>
            <p class="mt-5 text-xs leading-5 text-muted-foreground">
              Illustrative list of the dashboard's views. The numbers always come from your own
              Cloudflare Analytics Engine dataset; Forge never invents them.
            </p>
          </div>

          <div class="order-1 lg:order-2">
            <p class="forge-section-mark">
              Analytics <span class="forge-experimental-badge ml-1">Experimental</span>
            </p>
            <h2 id="analytics-title" class="forge-section-title mt-5">
              Is anyone visiting? The client can see.
            </h2>
            <p class="mt-5 max-w-[48ch] leading-7 text-muted-foreground">
              Your client opens the same admin they use for content and sees whether people are
              actually visiting the site. Built on Cloudflare Analytics Engine.
            </p>
            <h3 class="mt-6 text-sm font-semibold">Privacy by construction</h3>
            <ul class="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              @for (item of facts.privacy; track item) {
                <li class="flex gap-2.5">
                  <span
                    class="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-primary"
                    aria-hidden="true"
                  ></span>
                  <span>{{ item }}</span>
                </li>
              }
            </ul>
            <a voltButton class="mt-8" routerLink="/docs/analytics">
              Analytics docs
              <lmn-arrow-right [size]="16" />
            </a>
          </div>
        </div>
      </div>
    </section>
  `
})
export class AnalyticsSectionComponent {
  protected readonly facts = analyticsFacts;
}
