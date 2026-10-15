import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltNativeButton } from '@voltui/components';
import { MoveInViewDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { CURRENT_FORGE_VERSION } from '../forge-release';
import { packages } from '../landing-data';

/**
 * Spec 097: the twelve packages as the stack they form — Angular experience on top of the runtime and
 * platform adapters, on top of the foundation — with quality and tooling alongside. Every package keeps
 * its name, purpose and honest version label in plain text; the layers only add structure.
 */
@Component({
  selector: 'forge-cms-packages-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltBadge,
    VoltNativeButton,
    MoveInViewDirective,
    MoveStaggerDirective,
    LmnArrowRightIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="packages" class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
      <div class="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p class="forge-section-mark">A composable foundation</p>
          <h2 class="forge-section-title mt-5 max-w-[16ch]">
            Bring the pieces your project needs.
          </h2>
          <p class="mt-5 max-w-[52ch] leading-7 text-muted-foreground">
            Twelve focused packages. The eleven stable ones move together at
            <strong class="font-semibold text-foreground">v{{ version }}</strong
            >; the experimental Agent Kit joins with the 1.0 release candidate.
          </p>
        </div>
        <dl class="forge-pkg-stats">
          <div>
            <dt>Packages</dt>
            <dd>{{ total }}</dd>
          </div>
          <div>
            <dt>Stable</dt>
            <dd>{{ stable }}</dd>
          </div>
          <div>
            <dt>Experimental</dt>
            <dd>{{ total - stable }}</dd>
          </div>
        </dl>
      </div>

      <div class="forge-pkg-board">
        <div class="forge-pkg-stack" moveStagger="90ms">
          @for (layer of layers; track layer.label) {
            <section
              class="forge-pkg-layer"
              [attr.data-layer]="layer.id"
              [attr.aria-labelledby]="'pkg-layer-' + layer.id"
              [moveInView]="reveal"
            >
              <header>
                <h3 [id]="'pkg-layer-' + layer.id">{{ layer.label }}</h3>
                <p>{{ layer.description }}</p>
              </header>
              <ul class="forge-pkg-tiles">
                @for (pkg of layer.items; track pkg.name) {
                  <li class="forge-pkg-tile">
                    <code><span class="forge-pkg-scope">&#64;forge-cms/</span>{{ pkg.name }}</code>
                    <p>{{ pkg.purpose }}</p>
                    <volt-badge variant="secondary">{{ pkg.version }}</volt-badge>
                  </li>
                }
              </ul>
            </section>
          }
        </div>

        <section
          class="forge-pkg-layer forge-pkg-side"
          data-layer="tooling"
          aria-labelledby="pkg-layer-tooling"
          [moveInView]="reveal"
        >
          <header>
            <h3 id="pkg-layer-tooling">{{ tooling.label }}</h3>
            <p>{{ tooling.description }}</p>
          </header>
          <ul class="forge-pkg-tiles">
            @for (pkg of tooling.items; track pkg.name) {
              <li class="forge-pkg-tile">
                <code><span class="forge-pkg-scope">&#64;forge-cms/</span>{{ pkg.name }}</code>
                <p>{{ pkg.purpose }}</p>
                <span class="flex flex-wrap items-center gap-1.5">
                  @if (pkg.availability === 'experimental') {
                    <span class="forge-experimental-badge">Experimental</span>
                  }
                  <volt-badge variant="secondary">{{ pkg.version }}</volt-badge>
                </span>
              </li>
            }
          </ul>
        </section>
      </div>

      <div class="mt-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <p class="max-w-3xl text-sm leading-6 text-muted-foreground">
          Databases: InMemory, libSQL and Cloudflare D1. Storage: InMemory, Cloudflare R2 and an
          S3-compatible service (Garage is the one certified in CI; AWS S3, Backblaze B2 and Wasabi
          are configurable, not certified). Two durable profiles are certified: Cloudflare (D1 + R2)
          and portable (libSQL + S3).
        </p>
        <a voltButton variant="outline" class="shrink-0" routerLink="/docs/quickstart">
          Open the quickstart
          <lmn-arrow-right [size]="16" />
        </a>
      </div>
    </section>
  `
})
export class PackagesSectionComponent {
  protected readonly version = CURRENT_FORGE_VERSION;
  protected readonly total = packages.length;
  protected readonly stable = packages.filter((pkg) => pkg.availability === 'stable').length;
  protected readonly reveal = { opacity: [0, 1], y: [18, 0] };
  /** Top of the stack first, as it reads: what you see, what runs it, what it stands on. */
  protected readonly layers = [
    {
      id: 'angular',
      label: 'Angular experience',
      description: 'Typed consumption and the reusable admin',
      items: packages.filter((pkg) => ['angular', 'admin'].includes(pkg.name))
    },
    {
      id: 'runtime',
      label: 'Runtime and platform',
      description: 'Operations, transport and deployment adapters',
      items: packages.filter((pkg) => ['api', 'runtime', 'cloudflare', 's3'].includes(pkg.name))
    },
    {
      id: 'foundation',
      label: 'Foundation',
      description: 'Model, data, identity and files',
      items: packages.filter((pkg) => ['core', 'db', 'auth', 'storage'].includes(pkg.name))
    }
  ] as const;
  protected readonly tooling = {
    label: 'Quality and tooling',
    description: 'Adapter contracts and coding-agent support',
    items: packages.filter((pkg) => ['testing', 'agent'].includes(pkg.name))
  } as const;
}
