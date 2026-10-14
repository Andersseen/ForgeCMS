import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { CURRENT_FORGE_VERSION } from '../forge-release';
import { packages } from '../landing-data';

@Component({
  selector: 'forge-cms-packages-section',
  standalone: true,
  imports: [RouterLink, VoltBadge, VoltNativeButton, LmnArrowRightIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="packages" class="mx-auto w-full max-w-7xl px-5 py-18 md:px-8 md:py-22">
      <div class="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p class="forge-section-mark">A composable foundation</p>
          <h2 class="forge-section-title mt-5 max-w-[16ch]">
            Bring the pieces your project needs.
          </h2>
        </div>
        <div class="max-w-xl">
          <p class="leading-7 text-muted-foreground">
            Twelve focused packages. The eleven stable ones move together at
            <strong class="font-semibold text-foreground">v{{ version }}</strong
            >; the experimental Agent Kit joins with the 1.0 release candidate. Start with the model
            and runtime, then add only the platform and Angular surfaces your application uses.
          </p>
          <a voltButton variant="ghost" class="mt-3 px-0" routerLink="/docs/quickstart">
            Open the quickstart
            <lmn-arrow-right [size]="16" />
          </a>
        </div>
      </div>

      <div class="mt-12 grid overflow-hidden rounded-[1.25rem] border border-border md:grid-cols-2">
        @for (group of groups; track group.label) {
          <section class="forge-package-group">
            <header class="flex items-end justify-between gap-4 border-b border-border pb-4">
              <div>
                <h3 class="font-semibold">{{ group.label }}</h3>
                <p class="mt-1 text-sm text-muted-foreground">{{ group.description }}</p>
              </div>
              <span class="text-xs text-muted-foreground">{{ group.items.length }} packages</span>
            </header>
            <div class="divide-y divide-border">
              @for (pkg of group.items; track pkg.name) {
                <div class="grid gap-2 py-4 sm:grid-cols-[1fr_1fr] sm:gap-4">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <code class="whitespace-nowrap text-sm font-semibold"
                      >&#64;forge-cms/{{ pkg.name }}</code
                    >
                    @if (pkg.availability === 'experimental') {
                      <span class="forge-experimental-badge">Experimental</span>
                    }
                    <volt-badge variant="secondary">{{ pkg.version }}</volt-badge>
                  </div>
                  <p class="text-sm leading-6 text-muted-foreground">{{ pkg.purpose }}</p>
                </div>
              }
            </div>
          </section>
        }
      </div>

      <p class="mt-6 max-w-3xl text-sm leading-6 text-muted-foreground">
        Databases: InMemory, libSQL and Cloudflare D1. Storage: InMemory, Cloudflare R2 and an
        S3-compatible service (Garage is the one certified in CI; AWS S3, Backblaze B2 and Wasabi
        are configurable, not certified). Two durable profiles are certified: Cloudflare (D1 + R2)
        and portable (libSQL + S3).
      </p>
    </section>
  `
})
export class PackagesSectionComponent {
  protected readonly version = CURRENT_FORGE_VERSION;
  protected readonly groups = [
    {
      label: 'Foundation',
      description: 'Model, data, identity and files',
      items: packages.filter((pkg) => ['core', 'db', 'auth', 'storage'].includes(pkg.name))
    },
    {
      label: 'Runtime and platform',
      description: 'Operations, transport and deployment adapters',
      items: packages.filter((pkg) => ['api', 'runtime', 'cloudflare', 's3'].includes(pkg.name))
    },
    {
      label: 'Angular experience',
      description: 'Typed consumption and reusable admin',
      items: packages.filter((pkg) => ['angular', 'admin'].includes(pkg.name))
    },
    {
      label: 'Quality and tooling',
      description: 'Adapter contracts and coding-agent support',
      items: packages.filter((pkg) => ['testing', 'agent'].includes(pkg.name))
    }
  ] as const;
}
