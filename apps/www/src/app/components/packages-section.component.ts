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
    <section id="packages" class="mx-auto w-full max-w-7xl px-5 py-22 md:px-8 md:py-28">
      <div class="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p class="forge-section-mark">One release line</p>
          <h2 class="forge-section-title mt-5 max-w-[16ch]">Install the system in layers.</h2>
        </div>
        <div class="max-w-xl">
          <p class="leading-7 text-muted-foreground">
            Ten focused packages move together at
            <strong class="font-semibold text-foreground">v{{ version }}</strong
            >. Start with the model and runtime, then add only the platform and Angular surfaces
            your application uses.
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
              <span class="text-xs text-muted-foreground">{{ group.items.length }}</span>
            </header>
            <div class="divide-y divide-border">
              @for (pkg of group.items; track pkg.name) {
                <div class="grid gap-2 py-4 sm:grid-cols-[0.8fr_1.2fr] sm:gap-4">
                  <div class="flex items-center gap-2">
                    <code class="break-all text-sm font-semibold"
                      >&#64;forge-cms/{{ pkg.name }}</code
                    >
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
        Available today: InMemory, libSQL/Turso and Cloudflare D1 databases, with InMemory and
        Cloudflare R2 storage. The portable S3 profile remains on the road to 1.0.
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
      label: 'Execution',
      description: 'Operations, transport and edge adapters',
      items: packages.filter((pkg) => ['api', 'runtime', 'cloudflare'].includes(pkg.name))
    },
    {
      label: 'Angular experience',
      description: 'Typed consumption and reusable admin',
      items: packages.filter((pkg) => ['angular', 'admin'].includes(pkg.name))
    },
    {
      label: 'Confidence',
      description: 'Contracts for adapters and consumers',
      items: packages.filter((pkg) => pkg.name === 'testing')
    }
  ] as const;
}
