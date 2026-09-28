import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltCard } from '@voltui/components';
import { CURRENT_FORGE_VERSION } from '../forge-release';
import { packages } from '../landing-data';

@Component({
  selector: 'forge-cms-packages-section',
  standalone: true,
  imports: [RouterLink, VoltBadge, VoltCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="packages" class="mx-auto w-full max-w-7xl px-6 py-20 md:px-8">
      <div class="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div>
          <volt-badge variant="outline">Packages</volt-badge>
          <h2 class="mt-5 text-3xl font-semibold md:text-5xl">Ten packages, one version.</h2>
          <p class="mt-5 text-lg leading-8 text-muted-foreground">
            Every public package is released together on npm, currently at
            <span class="font-semibold text-foreground">{{ version }}</span
            >. Install the core and runtime, then add Cloudflare, the Angular client or the admin
            when you need them.
          </p>
          <p class="mt-4 text-sm leading-6 text-muted-foreground">
            Supported today: InMemory, libSQL/Turso and Cloudflare D1 databases, plus InMemory and
            Cloudflare R2 storage. An S3-compatible adapter is planned for 0.10.
          </p>
          <a
            routerLink="/docs/quickstart"
            class="mt-6 inline-block text-sm font-medium underline underline-offset-4"
            >Quickstart</a
          >
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          @for (pkg of packages; track pkg.name) {
            <volt-card>
              <div class="flex h-full flex-col gap-2 p-5">
                <div class="flex items-center justify-between gap-4">
                  <span class="break-all font-semibold">&#64;forge-cms/{{ pkg.name }}</span>
                  <volt-badge variant="secondary">{{ pkg.version }}</volt-badge>
                </div>
                <p class="text-sm leading-6 text-muted-foreground">{{ pkg.purpose }}</p>
              </div>
            </volt-card>
          }
        </div>
      </div>
    </section>
  `
})
export class PackagesSectionComponent {
  protected readonly packages = packages;
  protected readonly version = CURRENT_FORGE_VERSION;
}
