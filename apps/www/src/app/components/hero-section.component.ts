import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltButton } from '@voltui/components';
import { exampleCode } from '../landing-data';

@Component({
  selector: 'forge-cms-hero-section',
  standalone: true,
  imports: [VoltBadge, VoltButton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="mx-auto grid w-full max-w-7xl gap-12 px-6 pb-20 pt-12 md:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-28 lg:pt-20"
    >
      <div>
        <volt-badge variant="secondary">Experimental Angular CMS foundation</volt-badge>
        <h1
          class="mt-6 max-w-4xl text-5xl font-semibold leading-[0.95] tracking-normal text-foreground md:text-7xl"
        >
          A Payload-like CMS path for Angular developers.
        </h1>
        <p class="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
          ForgeCMS is an open source monorepo for building a typed, adapter-driven CMS on top of
          Angular and Analog.js.
        </p>

        <div class="mt-9 flex flex-col gap-3 sm:flex-row">
          <a routerLink="/admin">
            <volt-button size="lg">Explore the admin demo</volt-button>
          </a>
          <a href="#architecture">
            <volt-button variant="outline" size="lg">Explore architecture</volt-button>
          </a>
          <a href="#packages">
            <volt-button variant="outline" size="lg">View packages</volt-button>
          </a>
        </div>
        <p class="mt-3 text-sm text-muted-foreground">
          Live demo — browses real collections through the actual ForgeCMS runtime; demo data may
          reset periodically.
        </p>
      </div>

      <section
        aria-label="ForgeCMS schema preview"
        class="relative rounded-lg border border-border bg-surface p-4 shadow-lg"
      >
        <div class="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div class="flex items-center gap-2">
            <span class="size-3 rounded-full bg-error"></span>
            <span class="size-3 rounded-full bg-warning"></span>
            <span class="size-3 rounded-full bg-success"></span>
          </div>
          <span class="text-xs font-medium text-muted-foreground">packages/core</span>
        </div>
        <pre
          class="overflow-x-auto rounded-md bg-muted p-5 text-sm leading-7 text-foreground"
        ><code>{{ exampleCode }}</code></pre>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <div class="rounded-md border border-border bg-background p-3">
            <p class="text-xs text-muted-foreground">Runtime</p>
            <p class="mt-1 font-semibold">Analog.js</p>
          </div>
          <div class="rounded-md border border-border bg-background p-3">
            <p class="text-xs text-muted-foreground">Language</p>
            <p class="mt-1 font-semibold">TypeScript</p>
          </div>
          <div class="rounded-md border border-border bg-background p-3">
            <p class="text-xs text-muted-foreground">License</p>
            <p class="mt-1 font-semibold">MIT</p>
          </div>
        </div>
      </section>
    </section>
  `
})
export class HeroSectionComponent {
  protected readonly exampleCode = exampleCode;
}
