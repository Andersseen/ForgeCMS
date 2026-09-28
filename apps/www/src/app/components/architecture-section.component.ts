import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  VoltBadge,
  VoltCard,
  VoltCardDescription,
  VoltCardHeader,
  VoltCardTitle
} from '@voltui/components';
import { features, localApiCode } from '../landing-data';

/** "What works today": the capabilities that exist, then what the Local API means in practice. */
@Component({
  selector: 'forge-cms-architecture-section',
  standalone: true,
  imports: [RouterLink, VoltBadge, VoltCard, VoltCardHeader, VoltCardTitle, VoltCardDescription],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="architecture" class="border-y border-border bg-background/70 py-20">
      <div class="mx-auto w-full max-w-7xl px-6 md:px-8">
        <div class="max-w-3xl">
          <volt-badge variant="outline">What works today</volt-badge>
          <h2 class="mt-5 text-3xl font-semibold md:text-5xl">
            A CMS core for Angular teams, already in use.
          </h2>
          <p class="mt-5 text-lg leading-8 text-muted-foreground">
            Everything below exists and runs in the apps in this repository. All of it is in the npm
            release except schema-drift safety, which ships in the next one. It is pre-1.0: APIs can
            still change between minor versions.
          </p>
        </div>

        <div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          @for (feature of features; track feature.title) {
            <volt-card>
              <volt-card-header>
                <volt-card-title>{{ feature.title }}</volt-card-title>
                <volt-card-description>{{ feature.description }}</volt-card-description>
              </volt-card-header>
            </volt-card>
          }
        </div>

        <div class="mt-14 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <h3 class="text-2xl font-semibold">What "Local API" means</h3>
            <p class="mt-4 leading-7 text-muted-foreground">
              Your server code talks to the CMS as a library, not a web service. An Analog route can
              compose several collections into one payload with no internal HTTP. Pass
              <code class="rounded bg-muted px-1 text-sm">overrideAccess: false</code> and the same
              access rules and draft visibility apply as for an anonymous visitor. The REST API and
              the Angular client use the same pipeline.
            </p>
            <a
              routerLink="/docs/local-api"
              class="mt-4 inline-block text-sm font-medium underline underline-offset-4"
              >Read the Local API guide</a
            >
          </div>
          <pre
            class="overflow-x-auto rounded-md border border-border bg-muted p-5 text-sm leading-7 text-foreground"
          ><code>{{ localApiCode }}</code></pre>
        </div>
      </div>
    </section>
  `
})
export class ArchitectureSectionComponent {
  protected readonly features = features;
  protected readonly localApiCode = localApiCode;
}
