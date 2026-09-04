import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltButton } from '@voltui/components';
import { exampleCode } from '../landing-data';
import { DemoDialogService } from './demo-dialog.service';

@Component({
  selector: 'forge-cms-hero-section',
  standalone: true,
  imports: [RouterLink, VoltBadge, VoltButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="mx-auto grid w-full max-w-7xl gap-12 px-6 pb-20 pt-12 md:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-28 lg:pt-20"
    >
      <div>
        <volt-badge variant="secondary">TypeScript-first Angular CMS</volt-badge>
        <h1
          class="mt-6 max-w-4xl text-5xl font-semibold leading-[0.95] tracking-normal text-foreground md:text-7xl"
        >
          A headless CMS built for Angular and Analog.
        </h1>
        <p class="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
          ForgeCMS pairs an embeddable admin with a typed runtime, Cloudflare-first adapters, and a
          portable core for small teams that want the CMS to fit their Angular app.
        </p>

        <div class="mt-9 flex flex-col gap-3 sm:flex-row">
          <a routerLink="/docs/small-project-guide">
            <volt-button size="lg">Get started</volt-button>
          </a>
          <a href="https://github.com/Andersseen/ForgeCMS" rel="noreferrer" target="_blank">
            <volt-button variant="outline" size="lg">GitHub</volt-button>
          </a>
        </div>
        <button
          type="button"
          class="mt-4 text-sm font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
          (click)="demo.open()"
        >
          See the clinic demo powered by the real runtime
        </button>
      </div>

      <section
        aria-label="ForgeCMS product preview"
        class="relative rounded-lg border border-border bg-surface p-4 shadow-lg"
      >
        <div class="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div class="flex items-center gap-2">
            <span class="size-3 rounded-full bg-error"></span>
            <span class="size-3 rounded-full bg-warning"></span>
            <span class="size-3 rounded-full bg-success"></span>
          </div>
          <span class="text-xs font-medium text-muted-foreground">collections / posts</span>
        </div>
        <div class="rounded-md border border-border bg-background">
          <div class="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p class="text-sm font-semibold">Posts</p>
              <p class="text-xs text-muted-foreground">Search, drafts, relations and publishing</p>
            </div>
            <volt-badge variant="secondary">Published</volt-badge>
          </div>
          <div class="divide-y divide-border text-sm">
            <div class="grid grid-cols-[1fr_auto] gap-4 px-4 py-3">
              <span>Small project guide</span>
              <span class="text-muted-foreground">Editor</span>
            </div>
            <div class="grid grid-cols-[1fr_auto] gap-4 px-4 py-3">
              <span>Cloudflare deployment notes</span>
              <span class="text-muted-foreground">Admin</span>
            </div>
            <div class="grid grid-cols-[1fr_auto] gap-4 px-4 py-3">
              <span>Portable libSQL setup</span>
              <span class="text-muted-foreground">Draft</span>
            </div>
          </div>
        </div>
        <pre
          class="mt-4 overflow-x-auto rounded-md bg-muted p-5 text-sm leading-7 text-foreground"
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
  protected readonly demo = inject(DemoDialogService);
  protected readonly exampleCode = exampleCode;
}
