import { Component } from '@angular/core';
import {
  VoltBadge,
  VoltButton,
  VoltCard,
  VoltCardContent,
  VoltCardDescription,
  VoltCardHeader,
  VoltCardTitle
} from '@voltui/components';
import { exampleCode, features, packages } from './landing-data';

@Component({
  selector: 'forge-cms-root',
  standalone: true,
  imports: [
    VoltBadge,
    VoltButton,
    VoltCard,
    VoltCardContent,
    VoltCardDescription,
    VoltCardHeader,
    VoltCardTitle
  ],
  template: `
    <main class="min-h-screen overflow-hidden">
      <header class="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5 md:px-8">
        <a class="flex items-center gap-3 text-sm font-semibold text-foreground" href="#">
          <img
            class="size-9 rounded-md"
            src="/logo.svg"
            alt="ForgeCMS logo"
            width="36"
            height="36"
          />
          <span>ForgeCMS</span>
        </a>

        <nav class="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
          <a class="transition hover:text-foreground" href="#architecture">Architecture</a>
          <a class="transition hover:text-foreground" href="#packages">Packages</a>
          <a class="transition hover:text-foreground" href="#roadmap">Roadmap</a>
        </nav>

        <a href="https://github.com/forge-cms/forge-cms" rel="noreferrer" target="_blank">
          <volt-button variant="outline" size="sm">GitHub</volt-button>
        </a>
      </header>

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
            <a href="#architecture">
              <volt-button size="lg">Explore architecture</volt-button>
            </a>
            <a href="#packages">
              <volt-button variant="outline" size="lg">View packages</volt-button>
            </a>
          </div>
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

      <section id="architecture" class="border-y border-border bg-background/70 py-20">
        <div class="mx-auto w-full max-w-7xl px-6 md:px-8">
          <div class="max-w-3xl">
            <volt-badge variant="outline">Architecture</volt-badge>
            <h2 class="mt-5 text-3xl font-semibold md:text-5xl">
              Small contracts before big features.
            </h2>
            <p class="mt-5 text-lg leading-8 text-muted-foreground">
              The first milestone is a stable package boundary: a pure TypeScript core, explicit
              adapter contracts, and a deployable app for showing the idea clearly.
            </p>
          </div>

          <div class="mt-10 grid gap-4 md:grid-cols-3">
            @for (feature of features; track feature.title) {
              <volt-card>
                <volt-card-header>
                  <volt-card-title>{{ feature.title }}</volt-card-title>
                  <volt-card-description>{{ feature.description }}</volt-card-description>
                </volt-card-header>
              </volt-card>
            }
          </div>
        </div>
      </section>

      <section id="packages" class="mx-auto w-full max-w-7xl px-6 py-20 md:px-8">
        <div class="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <volt-badge variant="outline">Monorepo</volt-badge>
            <h2 class="mt-5 text-3xl font-semibold md:text-5xl">Packages ready to grow.</h2>
            <p class="mt-5 text-lg leading-8 text-muted-foreground">
              Each package stays focused so future integrations for D1, R2, PostgreSQL, Drizzle,
              S3-compatible storage, and Forge auth can land without coupling everything together.
            </p>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            @for (pkg of packages; track pkg) {
              <volt-card>
                <volt-card-content class="flex items-center justify-between p-5">
                  <span class="font-semibold">&#64;forge-cms/{{ pkg }}</span>
                  <volt-badge variant="secondary">0.0.0</volt-badge>
                </volt-card-content>
              </volt-card>
            }
          </div>
        </div>
      </section>

      <section id="roadmap" class="bg-foreground px-6 py-20 text-background md:px-8">
        <div class="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[1fr_0.8fr] lg:items-center">
          <div>
            <p class="text-sm font-semibold uppercase tracking-normal text-background/60">
              Roadmap
            </p>
            <h2 class="mt-4 text-3xl font-semibold md:text-5xl">
              Build the CMS after the foundation is boring.
            </h2>
          </div>
          <div class="rounded-lg border border-background/20 bg-background/10 p-6">
            <p class="text-lg leading-8 text-background/75">
              Next steps: tighten the schema API, design adapter test suites, sketch CRUD route
              helpers, and evolve the admin package only when the core contracts are stable.
            </p>
          </div>
        </div>
      </section>
    </main>
  `
})
export class AppComponent {
  protected readonly features = features;
  protected readonly packages = packages;
  protected readonly exampleCode = exampleCode;
}
