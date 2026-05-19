import { ChangeDetectionStrategy, Component } from '@angular/core';
import { VoltBadge, VoltCard, VoltCardContent } from '@voltui/components';
import { packages } from '../landing-data';

@Component({
  selector: 'forge-cms-packages-section',
  standalone: true,
  imports: [VoltBadge, VoltCard, VoltCardContent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
  `
})
export class PackagesSectionComponent {
  protected readonly packages = packages;
}
